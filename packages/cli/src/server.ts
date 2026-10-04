import { Elysia } from "elysia";
import {
  type Service,
  getGlobalRegistry,
  ValidationError,
  ActionExecutionError,
  generateOpenApiSpec,
  type BaseContext,
  type Action,
  resolveSecrets,
  type SecretSource,
  type Logger,
  type CompiledRoutePlan,
  getCompiledCheck,
  buildErrorHelpers,
} from "@elregaldo/core";
import {
  requestLoggingPlugin,
  type RequestLoggingOptions,
} from "./request-logger";
import {
  scalarDocsHTML,
  registerReferenceRoute,
  type ReferenceOptions,
} from "./docs";
import {
  createEndpointHandler,
  endpointPaths,
  type BrickApp,
  type EndpointDefinition,
} from "./endpoints";

export interface CreateServerOptions {
  port?: number;
  services?: Service<any, any>[];
  prefix?: string;
  title?: string;
  version?: string;
  description?: string;
  docs?: boolean;
  openApiPath?: string;
  docsPath?: string;
  swaggerPath?: string;
  requestLogging?: boolean | RequestLoggingOptions; // default true
  reference?: boolean | ReferenceOptions; // default false, path "/reference"
  secrets?: { source?: SecretSource; validate?: boolean };
  /** Raw endpoints (outside the JSON action mesh), mounted at startup. */
  endpoints?: EndpointDefinition[];
}

let _srvSeq = 0;
const EMPTY_SERVICES = Object.freeze({});
const DEFAULT_REQUEST = new Request("http://localhost");

function isNonEmpty(obj: any): boolean {
  if (obj == null) return false;
  for (const _ in obj) return true;
  return false;
}

export function compileRoutePlan(
  service: Service,
  action: Action,
  routePath: string,
  method?: string
): CompiledRoutePlan {
  const actionName = action.name;
  const serviceName = service.name;
  const isGetLike =
    method === "GET" ||
    actionName.startsWith("get") ||
    actionName.endsWith(".get") ||
    actionName.startsWith("list") ||
    actionName.endsWith(".list") ||
    actionName.startsWith("find") ||
    actionName.startsWith("read");

  const inputSchema = action.config?.input;
  const outputSchema = action.config?.output;
  const hasInput = Boolean(inputSchema);
  const inputChecker = inputSchema ? (getCompiledCheck(inputSchema) as any) : undefined;
  const hasOutputCheck = Boolean(outputSchema);
  const outputChecker = outputSchema ? (getCompiledCheck(outputSchema) as any) : undefined;

  let coercions: Array<{ key: string; isNumber: boolean; isBoolean: boolean }> | undefined;
  if (inputSchema && typeof (inputSchema as any).properties === "object") {
    const list: Array<{ key: string; isNumber: boolean; isBoolean: boolean }> = [];
    for (const [key, prop] of Object.entries((inputSchema as any).properties) as [string, any][]) {
      const type = prop?.type;
      if (type === "number" || type === "integer") {
        list.push({ key, isNumber: true, isBoolean: false });
      } else if (type === "boolean") {
        list.push({ key, isNumber: false, isBoolean: true });
      }
    }
    if (list.length > 0) coercions = list;
  }

  const contextHook = service.options?.context;
  const hasContextHook = typeof contextHook === "function";

  const authorize = action.config?.authorize;
  const hasAuthorize = typeof authorize === "function";

  const execute = action.config?.execute;

  const tag = `[${serviceName}:${actionName}]`;
  const logger: Logger = {
    info: (...args) => console.log(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
    debug: (...args) => console.debug(tag, ...args),
  };

  const errorBuilder = (action as any).errorHelpers ?? buildErrorHelpers(action.config?.errors);
  const cachedDb = service.getDb();

  return {
    service,
    action,
    actionName,
    serviceName,
    routePath,
    method,
    isGetLike,
    hasInput,
    hasContextHook,
    contextHook,
    hasAuthorize,
    authorize,
    execute,
    inputChecker,
    outputChecker,
    coercions,
    logger,
    errorBuilder,
    cachedDb,
  };
}

export async function executeCompiledRoute(plan: CompiledRoutePlan, elysiaCtx: any) {
  const { params, body, query, headers, request, set } = elysiaCtx;
  const seq = (++_srvSeq).toString(36);
  const traceId = (headers && headers["x-trace-id"]) || `tr_${seq}`;
  const requestId = (headers && headers["x-request-id"]) || `req_${seq}`;

  if (set?.headers) {
    set.headers["x-trace-id"] = traceId;
    set.headers["x-request-id"] = requestId;
  }

  let input: any;
  if (plan.hasInput) {
    let coercedQuery = query;
    if (query && plan.coercions && plan.coercions.length > 0) {
      coercedQuery = { ...query };
      for (let i = 0; i < plan.coercions.length; i++) {
        const c = plan.coercions[i];
        const val = query[c.key];
        if (val !== undefined) {
          if (c.isNumber) {
            const num = Number(val);
            if (!isNaN(num)) coercedQuery[c.key] = num;
          } else if (c.isBoolean) {
            if (val === "true" || val === "1") coercedQuery[c.key] = true;
            else if (val === "false" || val === "0") coercedQuery[c.key] = false;
          }
        }
      }
    }

    const hasP = isNonEmpty(params);
    const hasB = isNonEmpty(body);
    const hasQ = isNonEmpty(coercedQuery);

    if (plan.isGetLike) {
      if (hasQ && !hasP && !hasB) {
        input = coercedQuery;
      } else if (hasP && !hasQ && !hasB) {
        input = params;
      } else if (hasB && !hasP && !hasQ) {
        input = body;
      } else if (hasQ || hasP || hasB) {
        input = Object.assign({}, coercedQuery, params, body);
      }
    } else {
      if (hasB && !hasP && !hasQ) {
        input = body;
      } else if (hasP && !hasB && !hasQ) {
        input = params;
      } else if (hasQ && !hasP && !hasB) {
        input = coercedQuery;
      } else if (hasP || hasB || hasQ) {
        input = Object.assign({}, params, body, coercedQuery);
      }
    }
  }

  const standardRequest = request instanceof Request ? request : DEFAULT_REQUEST;

  const ctx: any = {
    request: standardRequest,
    traceId,
    requestId,
    db: plan.cachedDb ?? plan.service.getDb(),
    logger: plan.logger,
    services: EMPTY_SERVICES,
    metadata: { headers },
    _resolved: true,
  };

  try {
    if (plan.hasContextHook) {
      const extra = plan.contextHook!(ctx);
      const resolved = extra instanceof Promise ? await extra : extra;
      if (resolved) {
        Object.assign(ctx, resolved);
      }
    }

    if (plan.hasInput && plan.inputChecker) {
      if (!plan.inputChecker.Check(input)) {
        const errors = Array.from(plan.inputChecker.Errors(input)).map((err: any) => ({
          path: err.path,
          message: err.message,
          value: err.value,
        }));
        throw new ValidationError(`Validation failed for action '${plan.actionName}' input`, errors);
      }
    }

    if (plan.hasAuthorize) {
      const authRes = plan.authorize!({
        ctx,
        input,
        user: ctx.user,
      });
      const isAuthorized = authRes instanceof Promise ? await authRes : authRes;
      if (!isAuthorized) {
        throw new ActionExecutionError("UNAUTHORIZED", `Access denied for action '${plan.actionName}'`, 403);
      }
    }

    const execRes = plan.execute({ input, ctx, error: plan.errorBuilder });
    const result = execRes instanceof Promise ? await execRes : execRes;

    if (plan.outputChecker) {
      if (!plan.outputChecker.Check(result)) {
        const errors = Array.from(plan.outputChecker.Errors(result)).map((err: any) => ({
          path: err.path,
          message: err.message,
          value: err.value,
        }));
        throw new ValidationError(`Validation failed for action '${plan.actionName}' output`, errors, 500);
      }
    }

    return result;
  } catch (err: any) {
    if (err instanceof ValidationError || err instanceof ActionExecutionError) {
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
}

export function createActionHandler(
  service: Service,
  action: Action,
  routePath: string,
  method?: string
) {
  const plan = compileRoutePlan(service, action, routePath, method);
  return (elysiaCtx: any) => executeCompiledRoute(plan, elysiaCtx);
}

export function createBrickServer(options: CreateServerOptions = {}): BrickApp {
  const prefix = options.prefix ?? "/api";
  const title = options.title ?? "Brick-TS API Mesh";
  const version = options.version ?? "1.0.0";
  const enableDocs = options.docs ?? true;
  const openApiPath = options.openApiPath ?? "/openapi.json";
  const docsPath = options.docsPath ?? "/docs";
  const swaggerPath = options.swaggerPath ?? "/swagger";

  const app = new Elysia();

  // Fail fast on missing required secrets before serving anything.
  // No-op when no secrets are registered.
  if (options.secrets?.validate !== false) {
    resolveSecrets({ source: options.secrets?.source });
  }

  // Diagnostics & health
  app.get("/_health", () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  app.get("/_brick/services", () => {
    return getGlobalRegistry().exportArchitecture();
  });

  // Request logging first so every route below is timed.
  const requestLogging = options.requestLogging ?? true;
  if (requestLogging !== false) {
    const pluginOpts = requestLogging === true ? {} : requestLogging;
    if (pluginOpts.enabled !== false) {
      app.use(requestLoggingPlugin(pluginOpts));
    }
  }

  // Scalar API reference (opt-in). Defaults to openApiPath for the spec URL.
  const reference = options.reference ?? false;
  if (reference !== false) {
    const refOpts = reference === true ? {} : reference;
    registerReferenceRoute(app, {
      path: refOpts.path ?? "/reference",
      title: refOpts.title ?? title,
      specUrl: refOpts.specUrl ?? openApiPath,
    });
  }

  const services = options.services ?? getGlobalRegistry().list();

  // Precompute plans and freeze immutable plans across all services
  for (const service of services) {
    if (typeof (service as any).build === "function") {
      (service as any).build();
    }
  }

  // Raw endpoints declared via options or app.endpoint() (declaration order).
  const endpointDefs: EndpointDefinition[] = [];

  // OpenAPI 3.1 & Interactive Documentation Endpoints
  if (enableDocs) {
    app.get(openApiPath, () => {
      const spec = generateOpenApiSpec({
        title,
        version,
        description: options.description,
        prefix,
        services,
      });
      // Raw endpoints show up in the spec alongside the action mesh.
      return { ...spec, paths: { ...(spec.paths ?? {}), ...endpointPaths(endpointDefs) } };
    });

    app.get(docsPath, ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return scalarDocsHTML(openApiPath, title);
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

  // Dedicated Route Registry
  const registeredRoutes = new Set<string>();

  const mountRoute = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    handler: any
  ) => {
    const routeKey = `${method} ${path}`;
    if (registeredRoutes.has(routeKey)) {
      return;
    }
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

  // Raw endpoints (outside the JSON action mesh).
  const mountEndpoint = (def: EndpointDefinition) => {
    endpointDefs.push(def);
    mountRoute(def.method, def.path, createEndpointHandler(def, services));
  };

  for (const def of options.endpoints ?? []) {
    mountEndpoint(def);
  }

  const brickApp = app as unknown as BrickApp;
  brickApp.endpoint = (def: EndpointDefinition) => {
    mountEndpoint(def);
  };
  brickApp.listEndpoints = () => [...endpointDefs];

  // Mount services
  for (const service of services) {
    // 2. Mount Service Resources REST endpoints
    if (typeof (service as any).listResources === "function") {
      for (const resource of (service as any).listResources()) {
        const resourceCollectionPath = `${prefix}/${resource.name}`;
        const resourceItemPath = `${prefix}/${resource.name}/:id`;

        if (resource.actions.list) {
          mountRoute("GET", resourceCollectionPath, createActionHandler(service, resource.actions.list, resourceCollectionPath, "GET"));
        }
        if (resource.actions.create) {
          mountRoute("POST", resourceCollectionPath, createActionHandler(service, resource.actions.create, resourceCollectionPath, "POST"));
        }
        if (resource.actions.get) {
          mountRoute("GET", resourceItemPath, createActionHandler(service, resource.actions.get, resourceItemPath, "GET"));
        }
        if (resource.actions.update) {
          mountRoute("PATCH", resourceItemPath, createActionHandler(service, resource.actions.update, resourceItemPath, "PATCH"));
          mountRoute("PUT", resourceItemPath, createActionHandler(service, resource.actions.update, resourceItemPath, "PUT"));
        }
        if (resource.actions.delete) {
          mountRoute("DELETE", resourceItemPath, createActionHandler(service, resource.actions.delete, resourceItemPath, "DELETE"));
        }
      }
    }

    // 3. Mount Service Actions and Custom Action Paths
    for (const action of service.listActions()) {
      const actionPath = `${prefix}/${service.name}/${action.name}`;
      const postHandler = createActionHandler(service, action, actionPath, "POST");

      // Mount default POST action endpoint
      mountRoute("POST", actionPath, postHandler);

      // Mount default GET for read-like actions
      if (
        action.name.startsWith("get") ||
        action.name.startsWith("list") ||
        action.name.startsWith("find") ||
        action.name.startsWith("read")
      ) {
        const getHandler = createActionHandler(service, action, actionPath, "GET");
        mountRoute("GET", actionPath, getHandler);
      }

      // If action defines custom path (e.g. path: "/api/public/pages/:slug")
      if (action.config?.path) {
        const customPath = action.config.path;
        const customMethod = action.config.method;

        if (customMethod) {
          mountRoute(customMethod, customPath, createActionHandler(service, action, customPath, customMethod));
        } else {
          // If no method specified, mount both GET and POST for custom path
          mountRoute("GET", customPath, createActionHandler(service, action, customPath, "GET"));
          mountRoute("POST", customPath, createActionHandler(service, action, customPath, "POST"));
        }
      }
    }
  }

  return brickApp;
}
