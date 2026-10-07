import type { Elysia } from "elysia";
import type { Service, DatabaseHandle } from "@brickkit/core";
import { ActionExecutionError, ValidationError } from "@brickkit/core";

export type EndpointMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Logger subset handed to endpoint handlers (mirrors action context loggers). */
export interface EndpointLogger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

/** Context for raw endpoint handlers: Elysia route fields + Brick extras. */
export interface EndpointContext {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  headers: Record<string, string>;
  request: Request;
  /** Elysia response setter (status/headers). Mutate like in `app.get`. */
  set: { status?: number; headers: Record<string, string> };
  /** Drizzle db from `service` (or first service with one); `undefined` when none. */
  db: any;
  logger: EndpointLogger;
  traceId: string;
  requestId: string;
}

export interface EndpointDefinition {
  method: EndpointMethod;
  /** Elysia-style path, e.g. `/p/:slug`. */
  path: string;
  handler: (ctx: EndpointContext) => unknown | Promise<unknown>;
  /** Db source: instance or registered service name. Defaults to first service with a db. */
  service?: Service<any, any> | string;
  /** Explicit database handle, independent of a service. */
  database?: DatabaseHandle<unknown>;
  summary?: string;
  description?: string;
  tags?: string[];
}

/** Resolve the db for an endpoint: explicit service first, else first service holding one. */
export function resolveEndpointDb(
  service: Service<any, any> | string | undefined,
  services: Service<any, any>[]
): any {
  if (service) {
    const svc =
      typeof service === "string"
        ? services.find((s) => s.name === service)
        : (service as Service<any, any>);
    return svc?.getDb() ?? undefined;
  }
  for (const svc of services) {
    const db = svc.getDb();
    if (db) return db;
  }
  return undefined;
}

/** Wrap a raw handler with trace ids, logger, db, and mesh-consistent error mapping. */
export function createEndpointHandler(
  def: EndpointDefinition,
  services: Service<any, any>[]
): (elysiaCtx: any) => Promise<unknown> {
  return async ({ params, body, query, headers, request, set }: any) => {
    const traceId =
      headers?.["x-trace-id"] ||
      `tr_${Math.random().toString(36).substring(2, 10)}`;
    const requestId =
      headers?.["x-request-id"] ||
      `req_${Math.random().toString(36).substring(2, 10)}`;

    if (set?.headers) {
      set.headers["x-trace-id"] = traceId;
      set.headers["x-request-id"] = requestId;
    }

    const tag = `endpoint:${def.method} ${def.path}`;
    const ctx: EndpointContext = {
      body,
      db: def.database ? def.database.getDb() : resolveEndpointDb(def.service, services),
      headers: headers ?? {},
      logger: {
        info: (...args) => console.log(`[${tag}]`, ...args),
        warn: (...args) => console.warn(`[${tag}]`, ...args),
        error: (...args) => console.error(`[${tag}]`, ...args),
        debug: (...args) => console.debug(`[${tag}]`, ...args),
      },
      params: params ?? {},
      query: query ?? {},
      request:
        request instanceof Request
          ? request
          : new Request(`http://localhost${def.path}`, {
              headers: new Headers((headers as Record<string, string>) ?? {}),
              method: def.method,
            }),
      requestId,
      set,
      traceId,
    };

    try {
      return await def.handler(ctx);
    } catch (err: any) {
      if (err instanceof ValidationError) {
        set.status = err.status || 400;
        return err.toJSON();
      }
      if (err instanceof ActionExecutionError) {
        set.status = err.status || 400;
        return err.toJSON();
      }
      if (typeof err?.status === "number") {
        set.status = err.status;
        return { message: err.message || "Endpoint error", status: err.status };
      }
      set.status = 500;
      return {
        message: err?.message || "An unexpected error occurred",
        status: 500,
      };
    }
  };
}

/** `/p/:slug` → `/p/{slug}` for OpenAPI. */
export function toOpenApiPath(elysiaPath: string): string {
  return elysiaPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Parameter names (`:slug`) extracted for the OpenAPI path item. */
function pathParamNames(elysiaPath: string): string[] {
  return [...elysiaPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/** OpenAPI `paths` fragment for declared endpoints (raw HTML included). */
export function endpointPaths(defs: EndpointDefinition[]): Record<string, any> {
  const paths: Record<string, any> = {};
  for (const def of defs) {
    const openApiPath = toOpenApiPath(def.path);
    if (!paths[openApiPath]) paths[openApiPath] = {};
    const params = pathParamNames(def.path).map((name) => ({
      in: "path",
      name,
      required: true,
      schema: { type: "string" },
    }));
    paths[openApiPath][def.method.toLowerCase()] = {
      ...(def.summary ? { summary: def.summary } : {}),
      ...(def.description ? { description: def.description } : {}),
      ...(def.tags ? { tags: def.tags } : {}),
      ...(params.length > 0 ? { parameters: params } : {}),
      responses: { 200: { description: "Successful response" } },
    };
  }
  return paths;
}

/** The app object returned by `createBrickServer`: Elysia plus `endpoint()`. */
export type BrickApp = Elysia<any, any, any, any, any, any, any> & {
  /** Register a raw endpoint (outside the JSON action mesh). */
  endpoint(def: EndpointDefinition): void;
  /** All endpoints registered via `endpoint()` (declaration order). */
  listEndpoints(): EndpointDefinition[];
};
