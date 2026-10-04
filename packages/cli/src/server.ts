import { swaggerDocsHTML } from "./docs-html";
import { mountActionRoutes } from "./action-routes";
export { compileRoutePlan, executeCompiledRoute, createActionHandler } from "./action-handler";
import { installPlans, type CompiledPlans } from "./plans";
import { Elysia } from "elysia";
import {
  type Service,
  getGlobalRegistry,
  generateOpenApiSpec,
  resolveSecrets,
  type SecretSource,
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
  /** Offline brickc artifact, prepared once before routes are mounted. */
  plans?: CompiledPlans;
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

  if (options.plans) installPlans(options.plans, services);

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
      return swaggerDocsHTML(openApiPath, title);
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

  mountActionRoutes(services, prefix, mountRoute);

  return brickApp;
}
