import { type Service, type Action } from "../types";
import { getPluginActionRoute } from "../plugin";
import { getActionRoute, kebabCase } from "../routes";

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface RouteIR {
  readonly method: RouteMethod;
  readonly path: string;
  readonly service: string;
  readonly action: string;
  readonly kind: "action";
  readonly input: boolean;
  readonly output: boolean;
  readonly context: boolean;
  readonly authorize: boolean;
  readonly inputPrecedence: readonly ("query" | "params" | "body")[];
  readonly coercions: readonly {
    readonly key: string;
    readonly type: "number" | "boolean" | "array";
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
  readonly preparations: readonly {
    service: string;
    name: string;
    metadata: unknown;
  }[];
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
  for (const service of services) service.build();
  return analyzeDeclaredApplication(services, prefix);
}

/** Inspect current declarations without closing service/plugin setup. */
export function analyzeDeclaredApplication(
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
  }
  const routes: RouteIR[] = [];
  const bindings: RouteBinding[] = [];
  const registered = new Map<string, { name: string; plugin: boolean }>();
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
    const plugin = getPluginActionRoute(action, prefix) !== undefined;
    const key = `${method} ${path.replace(/:[^/]+/g, ":param")}`;
    const previous = registered.get(key);
    if (previous) {
      if (plugin || previous.plugin)
        throw new Error(
          `Brick compiler: duplicate plugin route '${method} ${path}'`,
        );
      diagnostics.push(
        `${key}: '${service.name}.${action.name}' shadowed by '${previous.name}' (first registration wins)`,
      );
      return;
    }
    if (typeof action.config.execute !== "function")
      throw new Error(
        `Brick compiler: '${service.name}.${action.name}' has no execute handler`,
      );
    registered.set(key, { name: `${service.name}.${action.name}`, plugin });
    const readLike =
      method === "GET" ||
      action.name.startsWith("get") ||
      action.name.endsWith(".get") ||
      action.name.startsWith("list") ||
      action.name.endsWith(".list") ||
      action.name.startsWith("find") ||
      action.name.startsWith("read");
    const coercions: { key: string; type: "number" | "boolean" | "array" }[] =
      [];
    for (const [key, prop] of Object.entries(
      action.config.input?.properties ?? {},
    ) as [string, any][]) {
      if (prop.type === "number" || prop.type === "integer")
        coercions.push({ key, type: "number" });
      else if (prop.type === "boolean")
        coercions.push({ key, type: "boolean" });
      else if (prop.type === "array") coercions.push({ key, type: "array" });
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
    checkSegments(service);
    for (const action of service.listActions()) {
      const route = getActionRoute(action, prefix);
      if (route === false) continue;
      add(service, action, route.method, route.path, "action");
    }
  }
  const preparations = services.flatMap((service) =>
    service.listPreparations().map((contribution) => ({
      service: service.name,
      name: contribution.name,
      metadata: schemaSnapshot(contribution.describe?.()),
    })),
  );
  const ir: BrickIR = freezeIR({
    version: 1,
    target: "bun-elysia",
    prefix,
    services: [...names],
    routes,
    preparations,
    diagnostics,
  });
  return { ir, bindings };
}

/** A service action, resource, and socket own the URL segment after the service. */
function checkSegments(service: Service<any, any>) {
  const owners = new Map<string, string>();
  const claim = (segment: string, owner: string) => {
    const previous = owners.get(segment);
    if (previous)
      throw new Error(
        `Brick: duplicate name "${segment}" in service "${service.name}": ${previous} and ${owner} share the URL segment`,
      );
    owners.set(segment, owner);
  };
  for (const resource of service.listResources())
    claim(kebabCase(resource.name), `resource "${resource.name}"`);
  for (const socket of service.listSockets())
    if (socket.schema.path === undefined)
      claim(kebabCase(socket.schema.name), `socket "${socket.schema.name}"`);
  for (const action of service.listActions())
    if (
      action.config.path === undefined &&
      !(action as { resourceAction?: unknown }).resourceAction &&
      getPluginActionRoute(action) === undefined
    )
      claim(kebabCase(action.name), `action "${action.name}"`);
}
