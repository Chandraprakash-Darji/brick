import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  MessageId,
  parseQueueName,
  parseQueueRoute,
  ValidQueueName,
  type Queue as QueueInterface,
  type QueuePrefix,
} from "@workflow/world";
import {
  createAppRouteUrl,
  createWorkflowBaseUrl,
  createWorkflowUrl,
} from "@workflow/utils";
import type { Redis } from "ioredis";
import { monotonicFactory } from "ulid";
import type { RedisWorldConfig } from "./config.js";
import { debug, hasBinary, uint8ArrayReplacer } from "./util.js";

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  /** Completed and failed delivery records are not retained. */
  completed: number;
  failed: number;
}

interface Envelope {
  messageId: MessageId;
  queueName: ValidQueueName;
  message: string;
  attempt: number;
  deliveryCount: number;
  createdAt: number;
  dedupKey: string;
  headers: Record<string, string>;
  route?: string;
}

// Derived from the upstream reliable Redis list queue. Every transition is a
// single script: a process crash cannot leave a message between structures.
const ENQUEUE = `
  if ARGV[1] ~= '' then
    local existing = redis.call('GET', KEYS[1])
    if existing then return existing end
    redis.call('SET', KEYS[1], ARGV[2])
    if tonumber(ARGV[3]) > 0 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
  end
  if tonumber(ARGV[5]) > 0 then
    redis.call('ZADD', KEYS[3], ARGV[5], ARGV[4])
  else
    redis.call('LPUSH', KEYS[2], ARGV[4])
  end
  return ARGV[2]
`;
const RESERVE = `
  if redis.call('EXISTS', KEYS[3]) == 0 then return nil end
  local raw = redis.call('LINDEX', KEYS[1], -1)
  if not raw then return nil end
  local job = cjson.decode(raw)
  job.attempt = job.attempt + 1
  job.deliveryCount = job.deliveryCount + 1
  local claim = cjson.encode(job)
  redis.call('RPOP', KEYS[1])
  redis.call('LPUSH', KEYS[2], claim)
  return claim
`;
const ACK = `
  if redis.call('EXISTS', KEYS[3]) == 0 then return 0 end
  if redis.call('LREM', KEYS[1], 1, ARGV[1]) == 0 then return 0 end
  if ARGV[2] ~= '' and redis.call('GET', KEYS[2]) == ARGV[3] then
    redis.call('DEL', KEYS[2])
  end
  return 1
`;
const DEFER = `
  if redis.call('EXISTS', KEYS[3]) == 0 then return 0 end
  if redis.call('LREM', KEYS[1], 1, ARGV[1]) == 0 then return 0 end
  redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2])
  return 1
`;
const PROMOTE = `
  local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
  for _, raw in ipairs(due) do
    redis.call('LPUSH', KEYS[2], raw)
    redis.call('ZREM', KEYS[1], raw)
  end
  return #due
`;
const RECLAIM = `
  if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
  local moved = 0
  for i = 1, 100 do
    local raw = redis.call('RPOPLPUSH', KEYS[1], KEYS[2])
    if not raw then break end
    moved = moved + 1
  end
  if redis.call('LLEN', KEYS[1]) == 0 then redis.call('SREM', KEYS[4], ARGV[1]) end
  return moved
`;
const RENEW = `
  if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  return 1
`;
const REGISTER = `
  redis.call('SET', KEYS[1], '1', 'PX', ARGV[2])
  redis.call('SADD', KEYS[2], ARGV[1])
`;
const STATS = `
  local active = 0
  for _, owner in ipairs(redis.call('SMEMBERS', KEYS[3])) do
    active = active + redis.call('LLEN', ARGV[1] .. ':processing:' .. owner)
  end
  return {redis.call('LLEN', KEYS[1]), active, redis.call('ZCARD', KEYS[2])}
`;

function parseEnvelope(raw: string): Envelope {
  const value: unknown = JSON.parse(raw);
  if (
    value === null ||
    typeof value !== "object" ||
    !("messageId" in value) ||
    !("queueName" in value) ||
    !("message" in value) ||
    typeof value.message !== "string" ||
    !("attempt" in value) ||
    typeof value.attempt !== "number" ||
    !("deliveryCount" in value) ||
    typeof value.deliveryCount !== "number" ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "number" ||
    !("dedupKey" in value) ||
    typeof value.dedupKey !== "string" ||
    !("headers" in value) ||
    value.headers === null ||
    typeof value.headers !== "object"
  ) {
    throw new TypeError("Invalid Redis queue envelope");
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value.headers)) {
    if (typeof header !== "string") throw new TypeError("Invalid queue header");
    headers[key] = header;
  }
  return {
    messageId: MessageId.parse(value.messageId),
    queueName: ValidQueueName.parse(value.queueName),
    message: value.message,
    attempt: value.attempt,
    deliveryCount: value.deliveryCount,
    createdAt: value.createdAt,
    dedupKey: value.dedupKey,
    headers,
    ...("route" in value &&
      typeof value.route === "string" && { route: value.route }),
  };
}

function serializeQueueMessage(message: unknown): string {
  return hasBinary(message)
    ? JSON.stringify(message, uint8ArrayReplacer)
    : JSON.stringify(message);
}

function queueMessageReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    const tagged = value as { __type?: unknown; data?: unknown };
    if (tagged.__type === "Uint8Array" && typeof tagged.data === "string") {
      return new Uint8Array(Buffer.from(tagged.data, "base64"));
    }
  }
  return value;
}

function deserializeQueueMessage(text: string): unknown {
  // Queue messages carry no Date fields, so with the tag absent a plain parse
  // is exactly equivalent.
  return text.includes('"__type"')
    ? JSON.parse(text, queueMessageReviver)
    : JSON.parse(text);
}

function resolveBaseUrl(config: RedisWorldConfig): string {
  return (
    config.baseUrl ||
    process.env.WORKFLOW_BASE_URL ||
    `http://localhost:${process.env.PORT ?? "3000"}`
  );
}

export function createQueue(
  redis: Redis,
  config: RedisWorldConfig,
): QueueInterface & {
  start(): Promise<void>;
  close(): Promise<void>;
  getQueueStats(): Promise<QueueStats>;
} {
  const generateMessageId = monotonicFactory();
  const root = `${config.keyPrefix || "workflow:"}queue:flows`;
  const ready = root;
  const delayed = `${root}:delayed`;
  const owners = `${root}:workers`;
  const processing = (owner: string) => `${root}:processing:${owner}`;
  const heartbeat = (owner: string) => `${root}:heartbeat:${owner}`;
  const heartbeatTtlMs = config.heartbeatTtlMs ?? 90_000;
  const concurrency = config.queueConcurrency ?? 10;
  const maxAttempts = config.maxAttempts ?? 73;
  const maxBackoffMs = config.maxBackoffMs ?? 30_000;
  const backoffDelayMs = config.backoffDelayMs ?? 1000;
  const httpTimeoutMs = config.httpTimeoutMs ?? 300_000;
  for (const [name, value, minimum] of [
    ["heartbeatTtlMs", heartbeatTtlMs, 300],
    ["queueConcurrency", concurrency, 1],
    ["maxAttempts", maxAttempts, 49],
    ["maxBackoffMs", maxBackoffMs, 1],
    ["backoffDelayMs", backoffDelayMs, 0],
    ["httpTimeoutMs", httpTimeoutMs, 1],
    ...(config.idempotencyTtlMs === undefined
      ? []
      : [["idempotencyTtlMs", config.idempotencyTtlMs, 1]]),
  ] as const) {
    if (
      typeof value !== "number" ||
      typeof minimum !== "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > 2_147_483_647
    ) {
      throw new RangeError(
        `${name} must be an integer between ${minimum} and 2147483647`,
      );
    }
  }
  const directHandlers = new Map<
    QueuePrefix,
    (req: Request) => Promise<Response>
  >();
  const routes = new Map<QueuePrefix, string>();
  let closed = false;
  let startPromise: Promise<void> | undefined;
  let loop: Promise<void> | undefined;
  let owner: string | undefined;
  const inflight = new Set<Promise<void>>();
  const lostOwners = new Set<string>();
  const abort = new AbortController();
  const sleep = () =>
    delay(50, undefined, { signal: abort.signal }).catch(() => {});

  const queue: QueueInterface["queue"] = async (queueName, message, opts) => {
    if (closed) throw new Error("Queue is closed");
    const { prefix } = parseQueueName(queueName);
    const messageId = MessageId.parse(`msg_${generateMessageId()}`);
    const dedupKey = opts?.idempotencyKey
      ? `${root}:idempotent:${opts.idempotencyKey}`
      : "";
    const envelope: Envelope = {
      messageId,
      queueName,
      message: serializeQueueMessage(message),
      attempt: 0,
      deliveryCount: 0,
      createdAt: Date.now(),
      dedupKey,
      headers: opts?.headers ?? {},
      ...(routes.has(prefix) && { route: routes.get(prefix) }),
    };
    const delayMs = Math.max(0, (opts?.delaySeconds ?? 0) * 1000);
    if (!Number.isFinite(delayMs))
      throw new RangeError("delaySeconds must be finite");
    const result = await redis.eval(
      ENQUEUE,
      3,
      dedupKey || ready,
      ready,
      delayed,
      dedupKey,
      messageId,
      config.idempotencyTtlMs ?? 0,
      JSON.stringify(envelope),
      delayMs > 0 ? Date.now() + delayMs : 0,
    );
    return { messageId: MessageId.parse(result) };
  };

  function parseReschedule(text: string): number | undefined {
    try {
      const seconds: unknown = JSON.parse(text)?.timeoutSeconds;
      if (
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        return seconds;
    } catch {
      /* A response without a timeout acknowledges the message. */
    }
    return undefined;
  }

  async function dispatch(job: Envelope): Promise<number | undefined> {
    const { prefix: queuePrefix } = parseQueueName(job.queueName);
    const messageId = job.messageId;
    const headers = new Headers(job.headers);
    headers.set("content-type", "application/json");
    headers.set("x-vqs-queue-name", job.queueName);
    headers.set("x-vqs-message-id", messageId);
    // Reservation persists attempts before dispatch, including crash redeliveries.
    headers.set("x-vqs-message-attempt", String(job.attempt));
    // Every delivery that reached a handler, reschedules included.
    headers.set("x-vqs-message-delivery-count", String(job.deliveryCount));
    headers.set(
      "x-vqs-message-created-at",
      new Date(job.createdAt).toISOString(),
    );

    const deliveryRoute = routes.get(queuePrefix) ?? job.route;
    const directHandler = directHandlers.get(queuePrefix);

    let response: Response;
    if (directHandler) {
      // In process: the request a route serving `createQueueHandler(prefix, ...)`
      // would receive, without the network hop.
      const localBase = createWorkflowBaseUrl("http://localhost");
      response = await directHandler(
        new Request(
          deliveryRoute
            ? createAppRouteUrl(localBase, deliveryRoute)
            : createWorkflowUrl(localBase, { type: "flow" }),
          { method: "POST", headers, body: job.message },
        ),
      );
    } else {
      const baseUrl = resolveBaseUrl(config);
      response = await fetch(
        deliveryRoute
          ? createAppRouteUrl(baseUrl, deliveryRoute)
          : createWorkflowUrl(baseUrl, { type: "flow" }),
        {
          method: "POST",
          headers,
          body: job.message,
          signal: AbortSignal.timeout(httpTimeoutMs),
        },
      );
    }

    const text = await response.text();

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
    return parseReschedule(text);
  }

  const createQueueHandler: QueueInterface["createQueueHandler"] = (
    queueNamePrefix,
    handler,
  ) => {
    return async (req) => {
      const queueName = req.headers.get(
        "x-vqs-queue-name",
      ) as ValidQueueName | null;
      const messageId = req.headers.get("x-vqs-message-id") as MessageId | null;
      const attemptStr = req.headers.get("x-vqs-message-attempt");
      const deliveryCountStr = req.headers.get("x-vqs-message-delivery-count");
      const createdAtStr = req.headers.get("x-vqs-message-created-at");

      if (!queueName || !messageId || !attemptStr || !req.body) {
        return Response.json(
          { error: "Missing required headers or body" },
          { status: 400 },
        );
      }
      if (!queueName.startsWith(queueNamePrefix)) {
        return Response.json({ error: "Unhandled queue" }, { status: 400 });
      }

      const attempt = Number.parseInt(attemptStr, 10);
      const deliveryCount = deliveryCountStr
        ? Number.parseInt(deliveryCountStr, 10)
        : attempt;
      const createdAt = createdAtStr ? new Date(createdAtStr) : undefined;

      try {
        const body = deserializeQueueMessage(await req.text());
        const result = await handler(body, {
          attempt,
          deliveryCount,
          ...(createdAt && !Number.isNaN(createdAt.getTime()) && { createdAt }),
          queueName,
          messageId,
        });

        const timeoutSeconds = (
          result as { timeoutSeconds?: unknown } | null | undefined
        )?.timeoutSeconds;
        if (
          typeof timeoutSeconds === "number" &&
          Number.isFinite(timeoutSeconds)
        ) {
          return Response.json({ timeoutSeconds: Math.max(0, timeoutSeconds) });
        }
        return Response.json({ ok: true });
      } catch (error) {
        debug("queue handler error:", error);
        return Response.json({ error: String(error) }, { status: 500 });
      }
    };
  };

  const getDeploymentId: QueueInterface["getDeploymentId"] = async () =>
    "redis";

  async function settle(raw: string, claimOwner: string): Promise<void> {
    try {
      const job = parseEnvelope(raw);
      let seconds: number | undefined;
      let failed = false;
      try {
        seconds = await dispatch(job);
      } catch (error) {
        failed = true;
        debug(
          `Delivery ${job.messageId} attempt ${job.attempt} failed:`,
          error,
        );
        const curve =
          config.backoffType === "fixed"
            ? backoffDelayMs
            : backoffDelayMs * 2 ** Math.min(30, job.attempt - 1);
        seconds =
          (job.attempt >= maxAttempts
            ? maxBackoffMs
            : Math.min(maxBackoffMs, curve)) / 1000;
        if (job.attempt === maxAttempts)
          console.error(
            `Queue message ${job.messageId} exhausted maxAttempts; retaining it for capped retries`,
          );
      }
      if (seconds === undefined) {
        await redis.eval(
          ACK,
          3,
          processing(claimOwner),
          job.dedupKey || ready,
          heartbeat(claimOwner),
          raw,
          job.dedupKey,
          job.messageId,
        );
      } else {
        // Only successful reschedules preserve the attempt. A crash always
        // leaves the reserved attempt in Redis, so reclaim counts as failure.
        const next = failed ? job : { ...job, attempt: job.attempt - 1 };
        await redis.eval(
          DEFER,
          3,
          processing(claimOwner),
          delayed,
          heartbeat(claimOwner),
          raw,
          JSON.stringify(next),
          Date.now() + seconds * 1000,
        );
      }
    } catch (error) {
      // Keep the claim for reclaim on connection loss or malformed data.
      lostOwners.add(claimOwner);
      console.error("Queue settlement error:", error);
    }
  }

  async function register(): Promise<string> {
    const next = randomUUID();
    await redis.eval(
      REGISTER,
      2,
      heartbeat(next),
      owners,
      next,
      heartbeatTtlMs,
    );
    return next;
  }

  async function run(): Promise<void> {
    let renewedAt = Date.now();
    let maintainedAt = 0;
    while (!closed) {
      try {
        for (const lost of lostOwners) {
          await redis.del(heartbeat(lost));
          lostOwners.delete(lost);
          if (owner === lost) owner = undefined;
        }
        if (!owner || Date.now() - renewedAt >= heartbeatTtlMs / 3) {
          // Never resurrect an expired lease: its processing list may already
          // belong to the reclaimer. A fresh UUID fences all old settlements.
          if (
            !owner ||
            (await redis.eval(RENEW, 1, heartbeat(owner), heartbeatTtlMs)) !== 1
          )
            owner = await register();
          renewedAt = Date.now();
        }
        if (Date.now() - maintainedAt >= 100) {
          await redis.eval(PROMOTE, 2, delayed, ready, Date.now());
          for (const stale of await redis.smembers(owners)) {
            if (stale !== owner)
              await redis.eval(
                RECLAIM,
                4,
                processing(stale),
                ready,
                heartbeat(stale),
                owners,
                stale,
              );
          }
          maintainedAt = Date.now();
        }
        for (
          let reserved = 0;
          reserved < concurrency &&
          !closed &&
          owner &&
          inflight.size < concurrency;
          reserved++
        ) {
          const claimOwner = owner;
          const raw = await redis.eval(
            RESERVE,
            3,
            ready,
            processing(claimOwner),
            heartbeat(claimOwner),
          );
          if (typeof raw !== "string") break;
          const task = settle(raw, claimOwner);
          inflight.add(task);
          void task.finally(() => inflight.delete(task));
        }
      } catch (error) {
        if (!closed) debug("Queue polling error:", error);
      }
      await sleep();
    }
  }

  return {
    queue,
    createQueueHandler,
    getDeploymentId,
    registerHandler(prefix, handler) {
      directHandlers.set(prefix, handler);
    },
    registerRoute(prefix, path) {
      routes.set(prefix, parseQueueRoute(path));
    },
    async getQueueStats() {
      const counts = await redis.eval(STATS, 3, ready, delayed, owners, root);
      if (
        !Array.isArray(counts) ||
        counts.length !== 3 ||
        counts.some((c) => typeof c !== "number")
      )
        throw new TypeError("Invalid queue statistics");
      return {
        waiting: Number(counts[0]),
        active: Number(counts[1]),
        delayed: Number(counts[2]),
        completed: 0,
        failed: 0,
      };
    },
    start() {
      if (closed) return Promise.reject(new Error("Queue is closed"));
      startPromise ??= (async () => {
        owner = await register();
        loop = run();
      })().catch((error) => {
        startPromise = undefined;
        throw error;
      });
      return startPromise;
    },
    async close() {
      if (closed) return;
      closed = true;
      abort.abort();
      await startPromise;
      await loop;
      // While handlers drain, keep the lease alive. close() must not permit a
      // live long-running handler to be reclaimed merely because shutdown began.
      const timer = setInterval(
        () => {
          if (owner)
            void redis
              .eval(RENEW, 1, heartbeat(owner), heartbeatTtlMs)
              .catch((error) => debug("Queue close heartbeat:", error));
        },
        Math.floor(heartbeatTtlMs / 3),
      );
      try {
        await Promise.all(inflight);
      } finally {
        clearInterval(timer);
      }
      if (owner) {
        await redis.del(heartbeat(owner));
        await redis.eval(
          RECLAIM,
          4,
          processing(owner),
          ready,
          heartbeat(owner),
          owners,
          owner,
        );
      }
    },
  };
}
