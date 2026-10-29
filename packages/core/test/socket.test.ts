import { afterEach, expect, it } from "bun:test";
import { brick, defineService, resetGlobalRegistry, t } from "../src";
import { defineElsewhere } from "./fixtures/define-elsewhere";
import {
  createBrickClient,
  BrickSocketError,
  type BrickClientSocket,
} from "../src/client";
import { serializeSocketSchema } from "../src/socket-schema";
import { restoreSocketSchema } from "../src/socket-schema";
import { Check } from "@sinclair/typebox/value";

const apps: ReturnType<typeof brick>[] = [];
const peers: WebSocket[] = [];
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.close();
  for (const app of apps.splice(0)) await app.stop(true);
  resetGlobalRegistry();
});

function start(service: ReturnType<typeof defineService>, compiler = true) {
  const app = brick({
    services: [service],
    prefix: "/v2",
    compiler,
    docs: false,
    requestLogging: false,
  }).listen(0);
  apps.push(app);
  return `http://localhost:${app.server!.port}`;
}
function open(url: string, headers?: Record<string, string>) {
  const ws = new WebSocket(
    url.replace(/^http/, "ws"),
    headers ? { headers } : undefined,
  );
  peers.push(ws);
  return new Promise<WebSocket>((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}
function message(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) =>
    ws.addEventListener(
      "message",
      ({ data }) => resolve(JSON.parse(String(data))),
      { once: true },
    ),
  );
}
function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) =>
    ws.addEventListener("close", ({ code }) => resolve(code), { once: true }),
  );
}
function echo(compiler = true) {
  const service = defineService("chat");
  service.socket({
    name: "live",
    input: { say: t.String() },
    output: { message: t.String() },
    allowMissingOrigin: true,
    handlers: { say: ({ input, socket }) => socket.send("message", input) },
  });
  return start(service, compiler);
}
const contract: {
  chat: { live: BrickClientSocket<{ say: string }, { message: string }> };
} = {
  chat: {
    live: {
      kind: "socket",
      name: "live",
      serviceName: "chat",
      config: { path: "/v2/chat/live" },
      output: { message: serializeSocketSchema(t.String()) },
    },
  },
};

for (const compiler of [true, false])
  it(`round trips through a real listener with compiler=${compiler}`, async () => {
    const api = createBrickClient({ baseUrl: echo(compiler), contract });
    const live = api.chat.live.connect();
    const received = new Promise<string>((resolve) =>
      live.on("message", resolve),
    );
    await live.ready;
    live.send("say", "hello");
    expect(await received).toBe("hello");
    live.close();
    expect(() => live.send("say", "again")).toThrow(BrickSocketError);
  });

it("resolves fresh context and rechecks authorization before every message", async () => {
  let active = true;
  let handled = 0;
  const service = defineService("chat", {
    context: ({ request }) => ({
      user:
        active && request.headers.get("cookie") === "session=yes"
          ? { id: "a" }
          : null,
    }),
  });
  service.socket({
    name: "live",
    input: { say: t.String() },
    output: { message: t.String() },
    allowMissingOrigin: true,
    authorize: ({ ctx }) => ctx.user != null,
    handlers: {
      say: ({ input, socket }) => {
        handled++;
        socket.send("message", input);
      },
    },
  });
  const url = start(service) + "/v2/chat/live";
  await expect(open(url)).rejects.toBeDefined();
  const ws = await open(url, { cookie: "session=yes" });
  const response = message(ws);
  ws.send(JSON.stringify({ event: "say", data: "allowed" }));
  expect(await response).toEqual({ event: "message", data: "allowed" });
  active = false;
  const ended = closed(ws);
  ws.send(JSON.stringify({ event: "say", data: "refused" }));
  expect(await ended).toBe(1008);
  expect(handled).toBe(1);
});

it("checks same-origin, configured origins, and missing origins separately", async () => {
  const service = defineService("chat");
  service.socket({
    name: "live",
    input: {},
    output: {},
    allowedOrigins: ["https://frontend.test"],
    handlers: {},
  });
  const url = start(service) + "/v2/chat/live";
  await expect(open(url)).rejects.toBeDefined();
  await expect(
    open(url, { origin: "https://attacker.test" }),
  ).rejects.toBeDefined();
  const ws = await open(url, { origin: "https://frontend.test" });
  expect(ws.readyState).toBe(1);
});

it("accepts same-origin browsers behind a TLS-terminating proxy", async () => {
  const url = echoSameOrigin() + "/v2/chat/live";
  await expect(
    open(url, { origin: "https://chat.example.com" }),
  ).rejects.toBeDefined();
  const ws = await open(url, {
    origin: "https://chat.example.com",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "chat.example.com",
  });
  expect(ws.readyState).toBe(1);
  await expect(
    open(url, {
      origin: "https://attacker.test",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "chat.example.com",
    }),
  ).rejects.toBeDefined();
});

function echoSameOrigin() {
  const service = defineService("chat");
  service.socket({
    name: "live",
    input: {},
    output: {},
    handlers: {},
  });
  return start(service);
}

for (const [payload, code] of [
  ["not json", 1007],
  [JSON.stringify({ event: "missing", data: "no" }), 1008],
  [JSON.stringify({ event: "say", data: 42 }), 1008],
  [JSON.stringify({ event: "say", data: "no", extra: true }), 1008],
  [new Uint8Array([1, 2]), 1003],
] as const)
  it(`rejects invalid frame ${String(payload)} before dispatch`, async () => {
    const ws = await open(echo() + "/v2/chat/live");
    const ended = closed(ws);
    ws.send(payload);
    expect(await ended).toBe(code);
  });

it("serializes async handlers and cleans up once", async () => {
  const seen: number[] = [];
  let cleanups = 0;
  const service = defineService("chat");
  service.socket({
    name: "live",
    input: { say: t.Number() },
    output: { message: t.Array(t.Number()) },
    allowMissingOrigin: true,
    handlers: {
      say: async ({ input, socket }) => {
        await Bun.sleep(input === 1 ? 20 : 0);
        seen.push(input);
        if (input === 2) socket.send("message", [...seen]);
      },
    },
    close: () => {
      cleanups++;
    },
  });
  const ws = await open(start(service) + "/v2/chat/live");
  const result = message(ws);
  ws.send(JSON.stringify({ event: "say", data: 1 }));
  ws.send(JSON.stringify({ event: "say", data: 2 }));
  expect(await result).toEqual({ event: "message", data: [1, 2] });
  const ended = closed(ws);
  ws.close();
  await ended;
  await apps[0]!.stop(true);
  apps.length = 0;
  expect(cleanups).toBe(1);
});

it("bounds pending messages while a handler is blocked", async () => {
  const gate = Promise.withResolvers<void>();
  const service = defineService("chat");
  service.socket({
    name: "live",
    input: { say: t.Number() },
    output: {},
    allowMissingOrigin: true,
    handlers: { say: () => gate.promise },
  });
  const ws = await open(start(service) + "/v2/chat/live");
  const ended = closed(ws);
  for (let i = 0; i < 40; i++)
    ws.send(JSON.stringify({ event: "say", data: i }));
  expect(await ended).toBe(1013);
  gate.resolve();
});

it("rejects conflicting routes and declarations after build", () => {
  const service = defineService("chat");
  const config = {
    name: "live",
    path: "/_health",
    input: {},
    output: {},
    handlers: {},
  };
  service.socket(config);
  expect(() => defineElsewhere(service, "socket", config)).toThrow(
    `duplicate socket "live" in service "chat"`,
  );
  expect(() => brick({ services: [service] })).toThrow(
    "duplicate socket route",
  );
  expect(() => service.socket({ ...config, name: "other" })).toThrow(
    "before service build",
  );
});

it("rejects nonportable schemas at declaration", () => {
  const service = defineService("chat");
  expect(() =>
    service.socket({
      name: "live",
      input: { say: t.Date() },
      output: {},
      handlers: { say() {} },
    }),
  ).toThrow("JSON values");
});

it("rejects invalid server output in the browser client", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("bad", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ event: "message", data: 42 }));
      },
      message() {},
    },
  });
  try {
    const live = createBrickClient({
      baseUrl: `http://localhost:${server.port}`,
      contract,
    }).chat.live.connect();
    const failed = new Promise<BrickSocketError>((resolve) =>
      live.onError(resolve),
    );
    await live.ready;
    expect((await failed).kind).toBe("protocol");
  } finally {
    await server.stop(true);
  }
});

it("handles already aborted connections and unsubscribes listeners", async () => {
  const api = createBrickClient({ baseUrl: echo(), contract });
  const controller = new AbortController();
  controller.abort();
  const aborted = api.chat.live.connect({ signal: controller.signal });
  await expect(aborted.ready).rejects.toHaveProperty("name", "AbortError");
  const live = api.chat.live.connect();
  let calls = 0;
  const off = live.on("message", () => {
    calls++;
  });
  off();
  const response = new Promise<string>((resolve) =>
    live.on("message", resolve),
  );
  await live.ready;
  live.send("say", "hello");
  expect(await response).toBe("hello");
  expect(calls).toBe(0);
  live.close();
});

it("validates recursive and record schemas after contract serialization", () => {
  const schema = t.Recursive((Self) =>
    t.Object({
      name: t.String(),
      labels: t.Record(t.String(), t.Number()),
      children: t.Array(Self),
    }),
  );
  const restored = restoreSocketSchema(
    JSON.parse(JSON.stringify(serializeSocketSchema(schema))),
  );
  expect(
    Check(restored, {
      name: "root",
      labels: { count: 1 },
      children: [{ name: "child", labels: {}, children: [] }],
    }),
  ).toBe(true);
  expect(
    Check(restored, {
      name: "root",
      labels: {},
      children: [{ name: 42, labels: {}, children: [] }],
    }),
  ).toBe(false);
});

it("does not start a handler when context resolves after closure", async () => {
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const cleaned = Promise.withResolvers<void>();
  let resolutions = 0;
  let handled = 0;
  let cleanups = 0;
  const service = defineService("chat", {
    context: async () => {
      if (++resolutions === 2) {
        entered.resolve();
        await resume.promise;
      }
      return {};
    },
  });
  service.socket({
    name: "live",
    allowMissingOrigin: true,
    input: { say: t.String() },
    output: {},
    handlers: {
      say() {
        handled++;
      },
    },
    close() {
      cleanups++;
      cleaned.resolve();
    },
  });
  const ws = await open(start(service) + "/v2/chat/live");
  ws.send(JSON.stringify({ event: "say", data: "hello" }));
  await entered.promise;
  const ended = closed(ws);
  ws.close();
  await ended;
  await cleaned.promise;
  resume.resolve();
  await Bun.sleep(0);
  expect(handled).toBe(0);
  expect(cleanups).toBe(1);
});

it("closes oversized native frames", async () => {
  const ws = await open(echo() + "/v2/chat/live");
  const ended = closed(ws);
  ws.send(JSON.stringify({ event: "say", data: "a".repeat(65536) }));
  expect([1006, 1009]).toContain(await ended);
});

it("rejects HTTP route conflicts and dynamic socket paths", () => {
  const service = defineService("chat");
  expect(() =>
    service.socket({
      name: "bad",
      path: "/room/:id",
      input: {},
      output: {},
      handlers: {},
    }),
  ).toThrow("static");
  service.socket({ name: "live", input: {}, output: {}, handlers: {} });
  service.action({
    name: "get",
    path: "/v2/chat/live",
    method: "GET",
    execute() {},
  });
  expect(() => brick({ services: [service], prefix: "/v2" })).toThrow(
    "conflicts with a socket",
  );
});

it("cancels an open connection once", async () => {
  const controller = new AbortController();
  const live = createBrickClient({
    baseUrl: echo(),
    contract,
  }).chat.live.connect({ signal: controller.signal });
  let cleanups = 0;
  live.onClose(() => {
    cleanups++;
  });
  await live.ready;
  controller.abort();
  live.close();
  expect(cleanups).toBe(1);
  expect(() => live.send("say", "after abort")).toThrow("not open");
});

it("times out a pending handshake", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch() {
      await Bun.sleep(50);
      return new Response("refused", { status: 403 });
    },
  });
  try {
    const live = createBrickClient({
      baseUrl: `http://localhost:${server.port}`,
      contract,
    }).chat.live.connect({ timeoutMs: 5 });
    await expect(live.ready).rejects.toThrow("timed out");
    live.close();
  } finally {
    await server.stop(true);
  }
});
