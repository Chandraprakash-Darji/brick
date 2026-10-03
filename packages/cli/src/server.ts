import { Elysia } from "elysia";
import {
  type Service,
  getGlobalRegistry,
  ValidationError,
  ActionExecutionError,
  type ActionContext,
} from "@brick-ts/core";

export interface CreateServerOptions {
  port?: number;
  services?: Service[];
  prefix?: string;
}

export function createBrickServer(options: CreateServerOptions = {}) {
  const prefix = options.prefix ?? "/api";
  const app = new Elysia();

  // Built-in diagnostics & health
  app.get("/_health", () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  app.get("/_brick/services", () => {
    return getGlobalRegistry().exportArchitecture();
  });

  // Services to mount
  const services = options.services ?? getGlobalRegistry().list();

  for (const service of services) {
    for (const action of service.listActions()) {
      const actionPath = `${prefix}/${service.name}/${action.name}`;

      const handler = async ({ body, query, headers, set }: any) => {
        const traceId =
          headers["x-trace-id"] ||
          `tr_${Math.random().toString(36).substring(2, 10)}`;
        const requestId =
          headers["x-request-id"] ||
          `req_${Math.random().toString(36).substring(2, 10)}`;

        set.headers["x-trace-id"] = traceId;
        set.headers["x-request-id"] = requestId;

        // Determine input based on query or body
        const isGetLike =
          action.name.startsWith("get") ||
          action.name.startsWith("list") ||
          action.name.startsWith("find") ||
          action.name.startsWith("read");

        let input: any;
        if (isGetLike) {
          input = query && Object.keys(query).length > 0 ? query : (body ?? {});
        } else {
          input = body ?? (query && Object.keys(query).length > 0 ? query : {});
        }

        // If the action has no input schema defined, pass empty or undefined
        if (!action.config.input && Object.keys(input).length === 0) {
          input = undefined;
        }

        const ctx: ActionContext = {
          traceId,
          requestId,
          db: service.getDb(),
          logger: {
            info: (...args) => console.log(`[${service.name}:${action.name}]`, ...args),
            warn: (...args) => console.warn(`[${service.name}:${action.name}]`, ...args),
            error: (...args) => console.error(`[${service.name}:${action.name}]`, ...args),
            debug: (...args) => console.debug(`[${service.name}:${action.name}]`, ...args),
          },
          services: {},
          metadata: {
            headers,
          },
        };

        try {
          const result = await action.execute({ input, ctx });
          return result;
        } catch (err: any) {
          if (err instanceof ValidationError) {
            set.status = err.status || 400;
            return err.toJSON();
          }
          if (err instanceof ActionExecutionError) {
            set.status = err.status || 400;
            return err.toJSON();
          }

          set.status = 500;
          return {
            name: "InternalServerError",
            message: err.message || "An unexpected error occurred",
            status: 500,
          };
        }
      };

      // Register POST route
      app.post(actionPath, handler);

      // Register GET route if read-like action
      if (
        action.name.startsWith("get") ||
        action.name.startsWith("list") ||
        action.name.startsWith("find") ||
        action.name.startsWith("read")
      ) {
        app.get(actionPath, handler);
      }
    }
  }

  return app;
}
