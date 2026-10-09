import type { Static, TSchema } from "@sinclair/typebox";
import type { Action, ActionErrorDefinition, Resource } from "./types";
import { ActionExecutionError, ValidationError } from "./types";

/**
 * Eden/tRPC-style typed HTTP client inferred from Brick-TS application contracts.
 *
 * The frontend imports only the contract *type* — never a backend implementation:
 *
 * ```ts
 * import { createBrickClient } from "@brickkit/core/client";
 * import type { AppServer } from "./server"; // `import type`: erased at build
 *
 * const api = createBrickClient<AppServer>({ baseUrl: "http://localhost:4000" });
 * const pages = await api.page.list({ limit: 10, sort: "-createdAt" });
 * const created = await api.page.create({ title: "Hello", content: "World" });
 * ```
 *
 * Build the contract from individually-typed actions (each `defineAction` call
 * preserves its input/output/error literal types):
 *
 * ```ts
 * // server.ts (backend)
 * export const listPages = pagesService.action({ name: "page.list", ... });
 * export const createPage = pagesService.action({ name: "page.create", ... });
 * export const contract = defineAppContract({ page: { list: listPages, create: createPage } });
 * export type AppServer = typeof contract;
 * ```
 *
 * ## Result / error convention
 *
 * The client uses a throw-based convention that mirrors local `action.execute`
 * semantics, because TypeScript promises cannot encode thrown exception types:
 *
 * - Success → the promise resolves with the action output.
 * - Declared domain failures (your `errors: { SLUG_EXISTS: ... }`) and framework
 *   guards (UNAUTHORIZED/FORBIDDEN/NOT_FOUND/...) → rejected with
 *   {@link ActionExecutionError} carrying the declared `code`, `status`,
 *   `message`, and `details`. Narrow with `instanceof` and read `err.code`.
 * - Input/output validation failures → rejected with {@link ValidationError},
 *   exactly as local execution throws.
 * - Network failures, unparsable bodies, and non-OK responses outside the
 *   declared contract → {@link BrickTransportError} (4xx) or
 *   {@link BrickServerError} (5xx).
 * - Cancellation via `AbortSignal` → the native `AbortError` propagates
 *   unwrapped so `err.name === "AbortError"` keeps working.
 *
 * ## URL mapping
 *
 * A client path is a namespace walk ending in an action call. The leaf segment
 * decides the route, matching the server compiler (`packages/cli/src/compiler`):
 *
 * | Client call | HTTP request |
 * |---|---|
 * | `api.page.list(input)` | `GET /api/page?...` (query) |
 * | `api.page.create(input)` | `POST /api/page` (JSON body) |
 * | `api.page.get({ id })` | `GET /api/page/:id` (+ remaining input as query) |
 * | `api.page.update({ id, ...rest })` | `PATCH /api/page/:id` (JSON body of `rest`) |
 * | `api.page.delete({ id })` | `DELETE /api/page/:id` |
 * | `api.billing.charge(input)` | `POST /api/billing/charge` (JSON body) |
 *
 * The last rule covers every custom action: `api.<service>.<action>` (deeper
 * namespaces join the tail with `.` to rebuild dotted action names such as
 * `page.render`). By default the leading segment must equal the backend
 * service name and the segment above a resource operation must equal the
 * resource name. Pass the runtime contract (`contract` option) to drop that
 * constraint: routing then uses each action's bound `serviceName` and each
 * resource's `name`, so contract keys become purely organizational.
 * `GET`-style input is serialized as a query string; `POST`/`PATCH` input goes in the JSON body.
 */

export interface BrickClientOptions {
  /** Server origin, e.g. `"http://localhost:4000"`. No trailing slash required. */
  baseUrl: string;
  /**
   * Route prefix the server was mounted with (default `"/api"`).
   * Must match the `prefix` passed to `brick({ prefix })`.
   */
  prefix?: string;
  /**
   * Default headers sent with every call (e.g. an `Authorization` bearer).
   * A thunk is re-evaluated per call, so rotated tokens stay fresh.
   */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** `fetch` implementation. Defaults to `globalThis.fetch`. */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Default signal applied to every call (per-call `signal` wins). */
  signal?: AbortSignal;
  /** Default per-call timeout in milliseconds (per-call `timeoutMs` wins). */
  timeoutMs?: number;
  /**
   * The runtime contract object (same value `brickFromContract` receives).
   * When provided, routes resolve from bound metadata — each action's
   * `serviceName`/`name` and each resource's `name` — so contract keys can be
   * named freely. Omit it for pure type-only usage (`import type`), in which
   * case contract keys must match service/resource names.
   */
  contract?: Record<string, any>;
}

export interface BrickCallOptions {
  /** Extra headers merged over the client defaults for this call only. */
  headers?: Record<string, string>;
  /** Abort signal for this call only. Never wrapped: aborts reject with `AbortError`. */
  signal?: AbortSignal;
  /** Per-call timeout in milliseconds. Implemented with `AbortSignal.timeout`. */
  timeoutMs?: number;
}

/**
 * The request never received a meaningful server answer: DNS / connection
 * failure, a malformed body, or a 4xx response outside the declared contract
 * (no `code` and no `ValidationError` shape).
 */
export class BrickTransportError extends Error {
  readonly kind = "transport" as const;
  readonly status?: number;
  readonly url: string;
  readonly body?: unknown;
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts: { status?: number; url: string; body?: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = "BrickTransportError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
    this.cause = opts.cause;
  }
}

/**
 * The server answered 5xx without a declared `code` / `ValidationError` shape,
 * i.e. an unexpected failure rather than a modelled domain error.
 */
export class BrickServerError extends Error {
  readonly kind = "server" as const;
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(
    message: string,
    opts: { status: number; url: string; body: unknown },
  ) {
    super(message);
    this.name = "BrickServerError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

export function isBrickTransportError(
  err: unknown,
): err is BrickTransportError {
  return err instanceof BrickTransportError;
}

export function isBrickServerError(err: unknown): err is BrickServerError {
  return err instanceof BrickServerError;
}

/** Static input type from the schema, with a fallback for structural actions. */
export type InferActionInput<A> = A extends {
  config: { input?: infer S extends TSchema };
}
  ? Static<S>
  : A extends {
        execute(params: { input?: infer I; ctx?: any }): any;
      }
    ? I
    : A extends { run(input?: infer I, ctx?: any): any }
      ? I
      : A extends (params: { input?: infer I; ctx?: any }) => any
        ? I
        : unknown;

/** Resolved output type of an action. */
export type InferActionOutput<A> = A extends (
  ...args: any[]
) => Promise<infer O>
  ? O
  : A extends { execute(params: any): Promise<infer O> }
    ? O
    : unknown;

/** Union of error `code`s declared in an action's `errors` map. */
export type InferActionErrorCodes<A> = A extends {
  config: { errors?: infer E };
}
  ? E extends Record<string, ActionErrorDefinition>
    ? Extract<keyof E, string>
    : never
  : never;

/**
 * The declared failure shape of an action for `catch` narrowing:
 * ```ts
 * try { await api.page.create(input); }
 * catch (err) {
 *   if (err instanceof ActionExecutionError) {
 *     const code: InferActionErrorCodes<typeof createPage> | "UNAUTHORIZED" | ... = err.code;
 *   }
 * }
 * ```
 * (Standard framework codes are always possible alongside declared ones.)
 */
export type InferActionFailure<A> = ActionExecutionError & {
  code:
    | InferActionErrorCodes<A>
    | "BAD_REQUEST"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "INTERNAL_SERVER_ERROR"
    | "VALIDATION_ERROR";
};

/**
 * Typed caller for one action. Required inputs stay required; actions whose
 * input includes `undefined` (no schema / all-optional) can be called bare.
 */
export type BrickActionCaller<A> =
  undefined extends InferActionInput<A>
    ? (
        input?: InferActionInput<A>,
        options?: BrickCallOptions,
      ) => Promise<InferActionOutput<A>>
    : (
        input: InferActionInput<A>,
        options?: BrickCallOptions,
      ) => Promise<InferActionOutput<A>>;

/** Typed client for a {@link Resource}: its five CRUD operations. */
export type BrickResourceClient<R> = {
  [
    K in keyof R as K extends "list" | "get" | "create" | "update" | "delete"
      ? K
      : never
  ]: R[K] extends Action<any, any, any, any> ? BrickActionCaller<R[K]> : never;
};

/**
 * Recursively maps an application contract to its typed client. Leaves that
 * are actions (or action-like functions) become callers; resources become
 * `{ list, get, create, update, delete }`; plain namespace objects recurse.
 * Anything else passes through untouched.
 */
export type BrickClient<T> =
  T extends Action<any, any, any, any>
    ? BrickActionCaller<T>
    : T extends Resource<any, any>
      ? BrickResourceClient<T>
      : T extends (...args: any[]) => any
        ? BrickActionCaller<T>
        : T extends object
          ? { [K in keyof T]: BrickClient<T[K]> }
          : T;

/**
 * Identity helper that preserves literal action types when assembling the
 * shared contract object on the backend:
 * ```ts
 * export const contract = defineAppContract({ page: { list: listPages } });
 * export type AppServer = typeof contract;
 * ```
 */
export function defineAppContract<T extends Record<string, any>>(
  contract: T,
): T {
  return contract;
}

const RESOURCE_OPS = new Set(["list", "get", "create", "update", "delete"]);

interface ResolvedClientOptions {
  baseUrl: string;
  prefix: string;
  headers?: BrickClientOptions["headers"];
  fetch: NonNullable<BrickClientOptions["fetch"]>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (!trimmed)
    throw new Error("[Brick-TS client] `baseUrl` must not be empty.");
  return trimmed;
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return "/api";
  const withLeading = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, "") : withLeading;
}

function toQueryString(input: unknown): string {
  if (input == null || typeof input !== "object") return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        params.append(
          key,
          typeof item === "object" ? JSON.stringify(item) : String(item),
        );
      }
    } else if (typeof value === "object") {
      params.append(key, JSON.stringify(value));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function extractId(input: unknown): {
  id: string;
  rest: Record<string, unknown>;
} {
  const record = (input ?? {}) as Record<string, unknown>;
  const raw = record.id ?? record.ID;
  if (raw === undefined || raw === null || raw === "") {
    throw new Error(
      "[Brick-TS client] Resource get/update/delete require an `id` in the input.",
    );
  }
  const { id: _droppedLower, ID: _droppedUpper, ...rest } = record;
  return { id: String(raw), rest };
}

interface PlannedRequest {
  method: string;
  url: string;
  body: unknown;
  hasBody: boolean;
}

function isActionValue(value: unknown): value is {
  serviceName?: unknown;
  name?: unknown;
  config: Action<any, any, any, any>["config"];
} & Function {
  return (
    typeof value === "function" &&
    !!(value as any).config &&
    typeof (value as any).config.execute === "function"
  );
}

function isResourceValue(value: unknown): value is { name: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as any).name === "string" &&
    !!(value as any).actions &&
    typeof (value as any).actions === "object"
  );
}

function planRequest(
  path: string[],
  /** Runtime contract value at `path`, when the `contract` option is set. */
  target: unknown,
  /** Runtime contract value at `path.slice(0, -1)`. */
  parent: unknown,
  input: unknown,
  baseUrl: string,
  prefix: string,
): PlannedRequest {
  if (path.length === 0) {
    throw new Error(
      "[Brick-TS client] No action selected: call a leaf such as `api.page.list(input)`.",
    );
  }
  const leaf = path[path.length - 1]!;
  const actionConfig = isActionValue(target) ? target.config : undefined;
  // Exact mode: the runtime contract reveals the bound resource name.
  const resource =
    RESOURCE_OPS.has(leaf) && path.length >= 2 && isResourceValue(parent)
      ? parent.name
      : path.length >= 2
        ? path[path.length - 2]!
        : undefined;
  if (
    RESOURCE_OPS.has(leaf) &&
    resource !== undefined &&
    (!actionConfig || isResourceValue(parent))
  ) {
    const collection = `${baseUrl}${prefix}/${encodeURIComponent(resource)}`;
    switch (leaf) {
      case "list":
        return {
          method: "GET",
          url: `${collection}${toQueryString(input)}`,
          body: undefined,
          hasBody: false,
        };
      case "create":
        return {
          method: "POST",
          url: collection,
          body: input,
          hasBody: input !== undefined,
        };
      case "get": {
        const { id, rest } = extractId(input);
        return {
          method: "GET",
          url: `${collection}/${encodeURIComponent(id)}${toQueryString(rest)}`,
          body: undefined,
          hasBody: false,
        };
      }
      case "update": {
        const { id, rest } = extractId(input);
        return {
          method: "PATCH",
          url: `${collection}/${encodeURIComponent(id)}`,
          body: rest,
          hasBody: true,
        };
      }
      case "delete": {
        const { id, rest } = extractId(input);
        return {
          method: "DELETE",
          url: `${collection}/${encodeURIComponent(id)}${toQueryString(rest)}`,
          body: undefined,
          hasBody: false,
        };
      }
    }
  }
  if (path.length < 2) {
    throw new Error(
      `[Brick-TS client] Cannot address '${path.join(".")}': custom actions need a service segment, e.g. \`api.${path[0]}.<action>(input)\`.`,
    );
  }
  // Exact mode: the runtime contract reveals the bound service/action names,
  // so contract keys can differ from backend names.
  const service =
    isActionValue(target) &&
    typeof target.serviceName === "string" &&
    target.serviceName
      ? target.serviceName
      : path[0]!;
  const action =
    isActionValue(target) && typeof target.name === "string" && target.name
      ? target.name
      : path.slice(1).join(".");
  const method = actionConfig?.method ?? "POST";
  const configuredPath = actionConfig?.path;
  let actionPath =
    configuredPath ??
    `${prefix}/${encodeURIComponent(service)}/${action.split(".").map(encodeURIComponent).join(".")}`;
  let remaining = input;
  if (configuredPath !== undefined) {
    if (!configuredPath.startsWith("/")) {
      throw new Error("[Brick-TS client] Action paths must start with '/'.");
    }
    const record = { ...((input ?? {}) as Record<string, unknown>) };
    actionPath = actionPath.replace(/:([^/]+)/g, (_match, key: string) => {
      const value = Object.hasOwn(record, key) ? record[key] : undefined;
      if (value === undefined || value === null || value === "") {
        throw new Error(`[Brick-TS client] Missing path parameter '${key}'.`);
      }
      delete record[key];
      return encodeURIComponent(String(value));
    });
    remaining = input === undefined ? undefined : record;
  }
  const queryOnly = method === "GET" || method === "DELETE";
  return {
    method,
    url: `${baseUrl}${actionPath}${queryOnly ? toQueryString(remaining) : ""}`,
    body: queryOnly ? undefined : remaining,
    hasBody: !queryOnly && remaining !== undefined,
  };
}

function toActionError(status: number, body: unknown, url: string): Error {
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.code === "string") {
      return new ActionExecutionError(
        record.code,
        typeof record.message === "string" ? record.message : record.code,
        typeof record.status === "number" ? record.status : status,
        (record.details ?? undefined) as unknown,
      );
    }
    if (record.name === "ValidationError") {
      return new ValidationError(
        typeof record.message === "string"
          ? record.message
          : "Validation failed",
        Array.isArray(record.errors) ? (record.errors as any) : [],
        typeof record.status === "number" ? record.status : status,
      );
    }
  }
  if (status >= 500) {
    return new BrickServerError(
      `Unexpected server error (status ${status}) for ${url}.`,
      {
        status,
        url,
        body,
      },
    );
  }
  return new BrickTransportError(
    `Request failed with status ${status} for ${url}.`,
    {
      status,
      url,
      body,
    },
  );
}

async function dispatch(
  resolved: ResolvedClientOptions,
  path: string[],
  target: unknown,
  parent: unknown,
  input: unknown,
  callOptions: BrickCallOptions | undefined,
): Promise<unknown> {
  const { method, url, body, hasBody } = planRequest(
    path,
    target,
    parent,
    input,
    resolved.baseUrl,
    resolved.prefix,
  );

  const staticHeaders =
    typeof resolved.headers === "function"
      ? await resolved.headers()
      : (resolved.headers ?? {});
  const headers: Record<string, string> = {
    accept: "application/json",
    ...staticHeaders,
    ...callOptions?.headers,
  };
  let payload: string | undefined;
  if (hasBody) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body ?? null);
  }

  const timeoutMs = callOptions?.timeoutMs ?? resolved.timeoutMs;
  let timeoutSignal: AbortSignal | undefined;
  if (timeoutMs !== undefined) timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callOptions?.signal ?? timeoutSignal ?? resolved.signal;

  let response: Response;
  try {
    response = await resolved.fetch(url, {
      method,
      headers,
      body: payload,
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new BrickTransportError(
      `Network request failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { url, cause: err },
    );
  }

  let parsed: unknown;
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/plain")) {
    parsed = text;
  } else if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      if (!response.headers.has("content-type")) {
        parsed = text;
      } else {
        throw new BrickTransportError(`Unparsable response body for ${url}.`, {
          status: response.status,
          url,
          cause: err,
        });
      }
    }
  }

  if (response.ok) return parsed;
  throw toActionError(response.status, parsed, url);
}

function childNode(node: unknown, prop: string): unknown {
  if (
    node != null &&
    (typeof node === "object" || typeof node === "function")
  ) {
    return (node as Record<string, unknown>)[prop];
  }
  return undefined;
}

function createNamespace(
  resolved: ResolvedClientOptions,
  path: string[],
  node: unknown,
  parent: unknown,
): any {
  const callable = async (input?: unknown, options?: BrickCallOptions) =>
    dispatch(resolved, path, node, parent, input, options);
  return new Proxy(callable, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      // Never masquerade as a thenable: awaiting a namespace must not dispatch.
      if (prop === "then" || prop === "catch" || prop === "finally")
        return undefined;
      return createNamespace(
        resolved,
        [...path, prop],
        childNode(node, prop),
        node,
      );
    },
    apply(_target, _thisArg, args: unknown[]) {
      const [input, options] = args as [unknown, BrickCallOptions | undefined];
      return dispatch(resolved, path, node, parent, input, options);
    },
  });
}

/**
 * Create an Eden/tRPC-style typed client for the application contract `TApp`.
 * `TApp` is a type-only parameter: `import type { AppServer }` keeps backend
 * implementations out of the frontend bundle.
 */
export function createBrickClient<TApp extends Record<string, any>>(
  options: BrickClientOptions,
): BrickClient<TApp> {
  if (!options?.baseUrl)
    throw new Error(
      '[Brick-TS client] `baseUrl` is required, e.g. `{ baseUrl: "http://localhost:4000" }`.',
    );
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "[Brick-TS client] No `fetch` implementation available: pass `fetch` explicitly.",
    );
  }
  const resolved: ResolvedClientOptions = {
    baseUrl: normalizeBaseUrl(options.baseUrl),
    prefix: normalizePrefix(options.prefix),
    headers: options.headers,
    fetch: fetchImpl,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  };
  return createNamespace(
    resolved,
    [],
    options.contract,
    undefined,
  ) as BrickClient<TApp>;
}
