import { Elysia } from "elysia";
import {
  type Service,
  getGlobalRegistry,
  ValidationError,
  ActionExecutionError,
  generateOpenApiSpec,
  type BaseContext,
  type Action,
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

function coerceQueryParams(query: any, schema: any): any {
  if (!query || !schema || !schema.properties) return query;
  const coerced: Record<string, any> = { ...query };
  for (const [key, prop] of Object.entries(schema.properties) as [string, any][]) {
    const val = query[key];
    if (val === undefined) continue;
    const type = prop?.type;
    if (type === "number" || type === "integer") {
      const num = Number(val);
      if (!isNaN(num)) coerced[key] = num;
    } else if (type === "boolean") {
      if (val === "true" || val === "1") coerced[key] = true;
      else if (val === "false" || val === "0") coerced[key] = false;
    }
  }
  return coerced;
}

function createActionHandler(service: Service, action: Action, routePath: string) {
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

    const isGetLike =
      action.name.startsWith("get") ||
      action.name.endsWith(".get") ||
      action.name.startsWith("list") ||
      action.name.endsWith(".list") ||
      action.name.startsWith("find") ||
      action.name.startsWith("read");

    const coercedQuery = coerceQueryParams(query, action.config.input);

    let input: any;
    if (isGetLike) {
      input = {
        ...(coercedQuery && Object.keys(coercedQuery).length > 0 ? coercedQuery : {}),
        ...(params && Object.keys(params).length > 0 ? params : {}),
        ...(body && typeof body === "object" ? body : {}),
      };
    } else {
      input = {
        ...(params && Object.keys(params).length > 0 ? params : {}),
        ...(body && typeof body === "object" ? body : {}),
        ...(coercedQuery && Object.keys(coercedQuery).length > 0 ? coercedQuery : {}),
      };
    }

    // If action requires no input and nothing passed, leave undefined
    if (!action.config.input && Object.keys(input).length === 0) {
      input = undefined;
    }

    const standardRequest =
      request instanceof Request
        ? request
        : new Request(`http://localhost${routePath}`, {
            method: isGetLike ? "GET" : "POST",
            headers: new Headers((headers as Record<string, string>) ?? {}),
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

  // Diagnostics & health
  app.get("/_health", () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  app.get("/_brick/services", () => {
    return getGlobalRegistry().exportArchitecture();
  });

  const services = options.services ?? getGlobalRegistry().list();

  // 1. Startup Schema Sync across all registered services (SQLite & Dev auto-creation)
  for (const service of services) {
    if (typeof (service as any).syncSchema === "function") {
      (service as any).syncSchema();
    }
  }

  // OpenAPI 3.1 & Interactive Documentation Endpoints
  if (enableDocs) {
    app.get(openApiPath, () => {
      return generateOpenApiSpec({
        title,
        version,
        description: options.description,
        prefix,
        services,
      });
    });

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

  // Set of registered routes to prevent duplicates
  const registeredRoutes = new Set<string>();

  const mountRoute = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    handler: any
  ) => {
    const routeKey = `${method}:${path}`;
    if (registeredRoutes.has(routeKey)) return;
    registeredRoutes.add(routeKey);

    switch (method) {
      case "GET":
        app.get(path, handler);
        break;
      case "POST":
        app.post(path, handler);
        break;
      case "PUT":
        app.put(path, handler);
        break;
      case "PATCH":
        app.patch(path, handler);
        break;
      case "DELETE":
        app.delete(path, handler);
        break;
    }
  };

  // Mount services
  for (const service of services) {
    // 2. Mount Service Resources REST endpoints
    if (typeof (service as any).listResources === "function") {
      for (const resource of (service as any).listResources()) {
        const resourceCollectionPath = `${prefix}/${resource.name}`;
        const resourceItemPath = `${prefix}/${resource.name}/:id`;

        if (resource.actions.list) {
          mountRoute("GET", resourceCollectionPath, createActionHandler(service, resource.actions.list, resourceCollectionPath));
        }
        if (resource.actions.create) {
          mountRoute("POST", resourceCollectionPath, createActionHandler(service, resource.actions.create, resourceCollectionPath));
        }
        if (resource.actions.get) {
          mountRoute("GET", resourceItemPath, createActionHandler(service, resource.actions.get, resourceItemPath));
        }
        if (resource.actions.update) {
          mountRoute("PATCH", resourceItemPath, createActionHandler(service, resource.actions.update, resourceItemPath));
          mountRoute("PUT", resourceItemPath, createActionHandler(service, resource.actions.update, resourceItemPath));
        }
        if (resource.actions.delete) {
          mountRoute("DELETE", resourceItemPath, createActionHandler(service, resource.actions.delete, resourceItemPath));
        }
      }
    }

    // 3. Mount Service Actions and Custom Action Paths
    for (const action of service.listActions()) {
      const actionPath = `${prefix}/${service.name}/${action.name}`;
      const handler = createActionHandler(service, action, actionPath);

      // Mount default POST action endpoint
      mountRoute("POST", actionPath, handler);

      // Mount default GET for read-like actions
      if (
        action.name.startsWith("get") ||
        action.name.startsWith("list") ||
        action.name.startsWith("find") ||
        action.name.startsWith("read")
      ) {
        mountRoute("GET", actionPath, handler);
      }

      // If action defines custom path (e.g. path: "/api/public/pages/:slug")
      if (action.config?.path) {
        const customPath = action.config.path;
        const customMethod = action.config.method;
        const customHandler = createActionHandler(service, action, customPath);

        if (customMethod) {
          mountRoute(customMethod, customPath, customHandler);
        } else {
          // If no method specified, mount both GET and POST for custom path
          mountRoute("GET", customPath, customHandler);
          mountRoute("POST", customPath, customHandler);
        }
      }
    }
  }

  return app;
}
