import { getPluginActionRoute } from "./plugin";
import type { ServiceRegistry } from "./registry";
import { getGlobalRegistry } from "./registry";
import type { Service, ActionErrorDefinition } from "./types";

export interface OpenApiGeneratorOptions {
  title?: string;
  version?: string;
  description?: string;
  prefix?: string;
  services?: Service<any, any>[];
  registry?: ServiceRegistry;
}

export function generateOpenApiSpec(
  options: OpenApiGeneratorOptions = {},
): Record<string, any> {
  const title = options.title ?? "Brick-TS API Mesh";
  const version = options.version ?? "1.0.0";
  const description =
    options.description ??
    "Automated OpenAPI 3.1.0 specification for Brick-TS modular service mesh.";
  const prefix = options.prefix ?? "/api";

  const services =
    options.services ??
    (options.registry ? options.registry.list() : getGlobalRegistry().list());

  const paths: Record<string, any> = {};
  const tagsSet = new Set<string>();
  let hasAnyAuthorizedAction = false;

  for (const service of services) {
    tagsSet.add(service.name);

    for (const action of service.listActions()) {
      const pluginRoute = getPluginActionRoute(action, prefix);
      if (pluginRoute === false) continue;
      const routePath =
        pluginRoute?.path ??
        action.config.path ??
        `${prefix}/${service.name}/${action.name}`;
      const method = (
        pluginRoute?.method ??
        action.config.method ??
        "POST"
      ).toLowerCase();
      const pathParams = [...routePath.matchAll(/:([^/]+)/g)].map(
        (match) => match[1]!,
      );
      const actionPath = routePath.replace(/:([^/]+)/g, "{$1}");
      if (!paths[actionPath]) paths[actionPath] = {};
      // Match the compiler's first-registration-wins policy for route collisions.
      if (paths[actionPath][method]) continue;

      const hasAuth = Boolean(action.config.authorize);
      if (hasAuth) {
        hasAnyAuthorizedAction = true;
      }

      // Build responses map
      const responses: Record<string, any> = {};

      // 200 Success Response
      if (action.config.output) {
        responses["200"] = {
          description: "Successful response",
          content: {
            "application/json": {
              schema: action.config.output,
            },
          },
        };
      } else {
        responses["200"] = {
          description: "Successful response",
        };
      }

      // 400 Validation Error (when input schema exists)
      if (action.config.input) {
        responses["400"] = {
          description: "Validation error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  message: { type: "string" },
                  status: { type: "integer" },
                  errors: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }

      // 403 Forbidden (when authorize hook exists)
      if (hasAuth) {
        responses["403"] = {
          description: "Access denied / Unauthorized",
        };
      }

      // Map action-defined error helpers (e.g. SLUG_EXISTS -> 409)
      if (action.config.errors) {
        for (const [code, errorDef] of Object.entries(action.config.errors)) {
          const def = errorDef as ActionErrorDefinition;
          const status = String(def.status || 400);
          responses[status] = {
            description: def.message || code,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", example: "ActionExecutionError" },
                    code: { type: "string", example: code },
                    message: { type: "string", example: def.message },
                    status: { type: "integer", example: def.status || 400 },
                  },
                },
              },
            },
          };
        }
      }

      // 500 Internal Server Error
      responses["500"] = {
        description: "Internal server error",
      };

      const operation: Record<string, any> = {
        operationId: `${service.name}_${action.name}_${method}`,
        summary: `${service.name}.${action.name}`,
        description:
          action.config.description ??
          `Execute action '${action.name}' on service '${service.name}'`,
        tags:
          action.config.tags && action.config.tags.length > 0
            ? action.config.tags
            : [service.name],
        responses,
      };

      const inputSchema = action.config.input;
      const properties = inputSchema?.properties ?? {};
      const parameters: any[] = [...new Set(pathParams)].map((key) => ({
        name: key,
        in: "path",
        required: true,
        schema: properties[key] ?? { type: "string" },
      }));
      const queryOnly = method === "get" || method === "delete";
      if (queryOnly) {
        for (const [key, schema] of Object.entries(properties)) {
          if (pathParams.includes(key)) continue;
          parameters.push({
            name: key,
            in: "query",
            required: inputSchema?.required?.includes(key) ?? false,
            schema,
          });
        }
      } else if (inputSchema) {
        const bodySchema =
          pathParams.length && inputSchema.properties
            ? {
                ...inputSchema,
                properties: Object.fromEntries(
                  Object.entries(properties).filter(
                    ([key]) => !pathParams.includes(key),
                  ),
                ),
                required: (inputSchema.required ?? []).filter(
                  (key: string) => !pathParams.includes(key),
                ),
              }
            : inputSchema;
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: bodySchema } },
        };
      }
      if (parameters.length) operation.parameters = parameters;
      if (hasAuth) operation.security = [{ bearerAuth: [] }];
      paths[actionPath][method] = operation;
    }
  }

  const spec: Record<string, any> = {
    openapi: "3.1.0",
    info: {
      title,
      version,
      description,
    },
    paths,
    tags: Array.from(tagsSet).map((name) => ({
      name,
      description: `Actions exposed by '${name}' service`,
    })),
  };

  if (hasAnyAuthorizedAction) {
    spec.components = {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your Bearer authentication token",
        },
      },
    };
  }

  return spec;
}
