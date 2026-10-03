import type { ServiceRegistry } from "./registry";
import { getGlobalRegistry } from "./registry";
import type { Action, Service, ActionErrorDefinition } from "./types";

export interface OpenApiGeneratorOptions {
  title?: string;
  version?: string;
  description?: string;
  prefix?: string;
  services?: Service[];
  registry?: ServiceRegistry;
}

export function generateOpenApiSpec(options: OpenApiGeneratorOptions = {}): Record<string, any> {
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
      const actionPath = `${prefix}/${service.name}/${action.name}`;
      if (!paths[actionPath]) {
        paths[actionPath] = {};
      }

      const isGetLike =
        action.name.startsWith("get") ||
        action.name.startsWith("list") ||
        action.name.startsWith("find") ||
        action.name.startsWith("read");

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

      // 1. Build POST Operation
      const postOperation: Record<string, any> = {
        operationId: `${service.name}_${action.name}_post`,
        summary: `${service.name}.${action.name}`,
        description: action.config.description ?? `Execute action '${action.name}' on service '${service.name}'`,
        tags: action.config.tags && action.config.tags.length > 0 ? action.config.tags : [service.name],
        responses,
      };

      if (action.config.input) {
        postOperation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: action.config.input,
            },
          },
        };
      }

      if (hasAuth) {
        postOperation.security = [{ bearerAuth: [] }];
      }

      paths[actionPath].post = postOperation;

      // 2. Build GET Operation for read-like actions
      if (isGetLike) {
        const getOperation: Record<string, any> = {
          operationId: `${service.name}_${action.name}_get`,
          summary: `${service.name}.${action.name}`,
          description: action.config.description ?? `Read-like query action '${action.name}' on service '${service.name}'`,
          tags: action.config.tags && action.config.tags.length > 0 ? action.config.tags : [service.name],
          responses,
        };

        if (action.config.input && typeof action.config.input === "object") {
          const inputSchema = action.config.input as any;
          if (inputSchema.properties) {
            const parameters: any[] = [];
            const requiredFields: string[] = inputSchema.required || [];

            for (const [key, propSchema] of Object.entries(inputSchema.properties)) {
              parameters.push({
                name: key,
                in: "query",
                required: requiredFields.includes(key),
                schema: propSchema,
              });
            }

            if (parameters.length > 0) {
              getOperation.parameters = parameters;
            }
          }
        }

        if (hasAuth) {
          getOperation.security = [{ bearerAuth: [] }];
        }

        paths[actionPath].get = getOperation;
      }
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
