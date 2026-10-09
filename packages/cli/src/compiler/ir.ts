import {
  type Service,
  type Action,
  describeResourceReads,
  type ResourceReadQueries,
} from "@brickkit/core";

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface RouteIR {
  readonly method: RouteMethod;
  readonly path: string;
  readonly service: string;
  readonly action: string;
  readonly kind: "action" | "resource";
  readonly input: boolean;
  readonly output: boolean;
  readonly context: boolean;
  readonly authorize: boolean;
  readonly inputPrecedence: readonly ("query" | "params" | "body")[];
  readonly coercions: readonly {
    readonly key: string;
    readonly type: "number" | "boolean";
  }[];
  /** JSON projection for inspection and stale-artifact detection, not runtime validation. */
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
}
export interface BrickIR {
  readonly version: 1;
  readonly target: "bun-elysia";
  readonly prefix: string;
  readonly services: readonly string[];
  readonly routes: readonly RouteIR[];
  readonly reads: readonly ResourceReadQueries[];
  readonly diagnostics: readonly string[];
}
export interface RouteBinding {
  readonly service: Service<any, any>;
  readonly action: Action<any, any, any, any>;
}

export function freezeIR<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeIR(child);
    Object.freeze(value);
  }
  return value;
}

function schemaSnapshot(schema: unknown): unknown {
  return schema === undefined ? undefined : JSON.parse(JSON.stringify(schema));
}

export function analyzeApplication(
  services: Service<any, any>[],
  prefix = "/api",
) {
  if (!prefix.startsWith("/"))
    throw new Error("Brick compiler: prefix must start with '/'");
  const names = new Set<string>();
  for (const service of services) {
    if (names.has(service.name))
      throw new Error(`Brick compiler: duplicate service '${service.name}'`);
    names.add(service.name);
    service.build();
  }
  const routes: RouteIR[] = [];
  const bindings: RouteBinding[] = [];
  const registered = new Map<string, string>();
  const diagnostics: string[] = [];
  const add = (
    service: Service<any, any>,
    action: Action<any, any, any, any>,
    method: RouteMethod,
    path: string,
    kind: RouteIR["kind"],
  ) => {
    if (!path.startsWith("/"))
      throw new Error(`Brick compiler: invalid route '${method} ${path}'`);
    const key = `${method} ${path}`;
    const previous = registered.get(key);
    if (previous) {
      diagnostics.push(
        `${key}: '${service.name}.${action.name}' shadowed by '${previous}' (first registration wins)`,
      );
      return;
    }
    if (typeof action.config.execute !== "function")
      throw new Error(
        `Brick compiler: '${service.name}.${action.name}' has no execute handler`,
      );
    registered.set(key, `${service.name}.${action.name}`);
    const readLike =
      method === "GET" ||
      action.name.startsWith("get") ||
      action.name.endsWith(".get") ||
      action.name.startsWith("list") ||
      action.name.endsWith(".list") ||
      action.name.startsWith("find") ||
      action.name.startsWith("read");
    const coercions: { key: string; type: "number" | "boolean" }[] = [];
    for (const [key, prop] of Object.entries(
      action.config.input?.properties ?? {},
    ) as [string, any][]) {
      if (prop.type === "number" || prop.type === "integer")
        coercions.push({ key, type: "number" });
      else if (prop.type === "boolean")
        coercions.push({ key, type: "boolean" });
    }
    routes.push({
      method,
      path,
      service: service.name,
      action: action.name,
      kind,
      input: Boolean(action.config.input),
      output: Boolean(action.config.output),
      context: typeof service.options.context === "function",
      authorize: typeof action.config.authorize === "function",
      inputPrecedence: readLike
        ? ["query", "params", "body"]
        : ["params", "body", "query"],
      coercions,
      inputSchema: schemaSnapshot(action.config.input),
      outputSchema: schemaSnapshot(action.config.output),
    });
    bindings.push({ service, action });
  };
  for (const service of services) {
    for (const resource of service.listResources()) {
      const collection = `${prefix}/${resource.name}`;
      const item = `${collection}/:id`;
      for (const [operation, method, path] of [
        ["list", "GET", collection],
        ["create", "POST", collection],
        ["get", "GET", item],
        ["update", "PATCH", item],
        ["update", "PUT", item],
        ["delete", "DELETE", item],
      ] as const) {
        const action = resource.actions[operation];
        if (action) add(service, action, method, path, "resource");
      }
    }
    for (const action of service.listActions()) {
      const path =
        action.config.path ?? `${prefix}/${service.name}/${action.name}`;
      add(service, action, action.config.method ?? "POST", path, "action");
    }
  }
  const reads = services.flatMap((service) =>
    service.listResources().flatMap((resource) => {
      const queries = describeResourceReads(service, resource);
      return queries ? [queries] : [];
    }),
  );
  const ir: BrickIR = freezeIR({
    version: 1,
    target: "bun-elysia",
    prefix,
    services: [...names],
    routes,
    reads,
    diagnostics,
  });
  return { ir, bindings };
}
