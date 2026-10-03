import { Elysia } from "elysia";
import {
  type Service,
  getGlobalRegistry,
  ValidationError,
  ActionExecutionError,
  generateOpenApiSpec,
  type BaseContext,
} from "@brick-ts/core";

export interface CreateServerOptions {
  port?: number;
  services?: Service[];
  prefix?: string;
  title?: string;
  version?: string;
  description?: string;
  docs?: boolean;
  openApiPath?: string;
  docsPath?: string;
  swaggerPath?: string;
}

export function createBrickServer(options: CreateServerOptions = {}) {
  const prefix = options.prefix ?? "/api";
  const title = options.title ?? "Brick-TS API Mesh";
  const version = options.version ?? "1.0.0";
  const enableDocs = options.docs ?? true;
  const openApiPath = options.openApiPath ?? "/openapi.json";
  const docsPath = options.docsPath ?? "/docs";
  const swaggerPath = options.swaggerPath ?? "/swagger";

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

  // OpenAPI 3.1 & Interactive Documentation Endpoints
  if (enableDocs) {
    // 1. OpenAPI 3.1 JSON Specification
    app.get(openApiPath, () => {
      return generateOpenApiSpec({
        title,
        version,
        description: options.description,
        prefix,
        services,
      });
    });

    // 2. Modern Scalar API Reference UI
    app.get(docsPath, ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return `<!doctype html>
<html>
  <head>
    <title>${title} — Interactive Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="https://scalar.com/favicon.svg" />
    <style>
      body { margin: 0; padding: 0; height: 100vh; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${openApiPath}"
      data-configuration='{"theme": "purple", "layout": "modern"}'
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">
    </script>
  </body>
</html>`;
    });

    // 3. Swagger UI Interface
    app.get(swaggerPath, ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${title} — Swagger UI</title>
    <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
      *, *:before, *:after { box-sizing: inherit; }
      body { margin:0; background: #fafafa; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" charset="UTF-8"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
    <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${openApiPath}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
    </script>
  </body>
</html>`;
    });
  }

  for (const service of services) {
    for (const action of service.listActions()) {
      const actionPath = `${prefix}/${service.name}/${action.name}`;

      const handler = async ({ body, query, headers, request, set }: any) => {
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

        // Construct standard Web Request object if not already provided
        const standardRequest =
          request instanceof Request
            ? request
            : new Request(`http://localhost${actionPath}`, {
                method: isGetLike ? "GET" : "POST",
                headers: new Headers(headers as Record<string, string>),
              });

        const baseCtx: BaseContext = {
          request: standardRequest,
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
          // Resolve service-level context (runs once per request)
          const resolvedCtx = await service.resolveContext(baseCtx);

          const result = await action.execute({ input, ctx: resolvedCtx });
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
