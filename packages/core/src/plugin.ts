import type { TSchema } from "@sinclair/typebox";
import type {
  Action,
  ActionConfigWithAuthorize,
  ActionConfigWithoutAuthorize,
  ActionContext,
  ActionErrorDefinition,
  BaseContext,
  Resource,
  Service,
} from "./types";
import { getGlobalRegistry } from "./registry";
import { defineAction } from "./action";

export type PluginRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type PluginRouteScope = "app" | "service" | "resource";
export type PluginRoutes<S extends PluginRouteScope = PluginRouteScope> =
  | false
  | Readonly<Record<string, false | { path?: string; scope?: S }>>;

type ContextOf<S> =
  S extends Service<infer D, infer C> ? BaseContext<D> & C : never;

export interface PluginEndpointContext<
  C extends ActionContext = ActionContext,
> {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  headers: Record<string, string>;
  request: Request;
  set: { status?: number; headers: Record<string, string> };
  ctx: C;
}

export interface PluginRouteRegistrar<
  C extends ActionContext = ActionContext,
  S extends PluginRouteScope = PluginRouteScope,
> {
  action<
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    E extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    config: ActionConfigWithAuthorize<I, O, E, C> & {
      path: string;
      method: PluginRouteMethod;
      scope?: S;
    },
  ): Action<I, O, E, C>;
  action<
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    E extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    config: ActionConfigWithoutAuthorize<I, O, E, C> & {
      path: string;
      method: PluginRouteMethod;
      scope?: S;
    },
  ): Action<I, O, E, C>;
  endpoint(config: {
    name: string;
    path: string;
    method: PluginRouteMethod;
    scope?: S;
    handler: (context: PluginEndpointContext<C>) => unknown | Promise<unknown>;
    summary?: string;
    description?: string;
    tags?: string[];
  }): void;
}

export interface ServicePluginContext<
  S extends Service<any, any> = Service<any, any>,
> {
  service: S;
  routes: PluginRouteRegistrar<ContextOf<S>, "app" | "service">;
}
export interface ResourcePluginContext<
  S extends Service<any, any> = Service<any, any>,
  R extends Resource<any, any, any> = Resource<any, ContextOf<S>, any>,
> {
  service: S;
  resource: R;
  routes: PluginRouteRegistrar<ContextOf<S>>;
}

const pluginKind = Symbol("Brick plugin");
export interface ServicePlugin<S extends Service<any, any>, A> {
  readonly [pluginKind]: "service";
  readonly name: string;
  readonly routes?: PluginRoutes<"app" | "service">;
  readonly setup: (context: ServicePluginContext<S>) => A;
}
export interface ResourcePlugin<
  S extends Service<any, any>,
  R extends Resource<any, any, any>,
  A extends object,
> {
  readonly [pluginKind]: "resource";
  readonly name: string;
  readonly routes?: PluginRoutes;
  readonly setup: (context: ResourcePluginContext<S, R>) => A;
}

export function defineServicePlugin<
  S extends Service<any, any> = Service<any, any>,
  A = unknown,
>(
  definition: Omit<ServicePlugin<S, A>, typeof pluginKind> & {
    setup: (
      context: ServicePluginContext<S>,
    ) => A & (A extends PromiseLike<unknown> ? never : unknown);
  },
): ServicePlugin<S, A> {
  validateName(definition.name);
  return Object.freeze({
    ...definition,
    routes: copyControls(definition.routes),
    [pluginKind]: "service" as const,
  });
}
export function defineResourcePlugin<
  S extends Service<any, any> = Service<any, any>,
  R extends Resource<any, any, any> = Resource<any, ContextOf<S>, any>,
  A extends object = object,
>(
  definition: Omit<ResourcePlugin<S, R, A>, typeof pluginKind> & {
    setup: (
      context: ResourcePluginContext<S, R>,
    ) => A & (A extends PromiseLike<unknown> ? never : unknown);
  },
): ResourcePlugin<S, R, A> {
  validateName(definition.name);
  return Object.freeze({
    ...definition,
    routes: copyControls(definition.routes),
    [pluginKind]: "resource" as const,
  });
}

function validateName(name: string) {
  if (!name || name.trim() !== name)
    throw new Error(
      "Plugin and route names must be nonempty and have no surrounding whitespace",
    );
}
function validatePath(path: string) {
  if (
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("//") ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid plugin route path '${path}'`);
  }
}
function copyControls<S extends PluginRouteScope>(
  controls: PluginRoutes<S> | undefined,
): PluginRoutes<S> | undefined {
  if (controls === undefined || controls === false) return controls;
  const result: Record<string, false | { path?: string; scope?: S }> =
    Object.create(null);
  for (const [name, value] of Object.entries(controls)) {
    validateName(name);
    if (value === false) {
      result[name] = false;
      continue;
    }
    if (value.path !== undefined) validatePath(value.path);
    if (
      value.scope !== undefined &&
      !["app", "service", "resource"].includes(value.scope)
    )
      throw new Error(`Invalid plugin route scope '${value.scope}'`);
    result[name] = Object.freeze({ ...value });
  }
  return Object.freeze(result);
}

interface Binding {
  service: Service<any, any>;
  resource?: Resource<any, any, any>;
  path: string;
  method: PluginRouteMethod;
  scope: PluginRouteScope;
  enabled: boolean;
  clientPath?: string[];
}
interface RawBinding extends Binding {
  handler: (context: PluginEndpointContext<any>) => unknown | Promise<unknown>;
  summary?: string;
  description?: string;
  tags?: string[];
}
interface Installation {
  descriptor: object;
  status: "installing" | "installed";
  api?: unknown;
}
interface PluginState {
  hosts: Map<object, Map<string, Installation>>;
  actions: Map<Action<any, any, any, any>, Binding>;
  endpoints: RawBinding[];
}
const states = new WeakMap<object, PluginState>();
const actionBindings = new WeakMap<Action<any, any, any, any>, Binding>();
function stateOf(service: Service<any, any>): PluginState {
  let state = states.get(service);
  if (!state) {
    state = { hosts: new Map(), actions: new Map(), endpoints: [] };
    states.set(service, state);
  }
  return state;
}
export function isInstallingPlugin(service: Service<any, any>): boolean {
  return [...(states.get(service)?.hosts.values() ?? [])].some(
    (installations) =>
      [...installations.values()].some((item) => item.status === "installing"),
  );
}

function pathOf(binding: Binding, prefix: string) {
  const scope =
    binding.scope === "app"
      ? ""
      : `/${binding.scope === "resource" ? binding.resource!.name : binding.service.name}`;
  return (
    `${prefix.replace(/\/$/, "")}${scope}${binding.path === "/" ? "" : binding.path}` ||
    "/"
  );
}
export function getPluginActionRoute(
  action: Action<any, any, any, any>,
  prefix = "/api",
) {
  const binding = actionBindings.get(action);
  if (!binding) return undefined;
  if (!binding.enabled) return false;
  return {
    path: pathOf(binding, prefix),
    method: binding.method,
    clientPath: binding.clientPath,
  };
}
export function getPluginEndpoints(
  service: Service<any, any>,
  prefix = "/api",
) {
  return stateOf(service)
    .endpoints.filter((binding) => binding.enabled)
    .map((binding) => ({
      path: pathOf(binding, prefix),
      method: binding.method,
      service,
      summary: binding.summary,
      description: binding.description,
      tags: binding.tags,
      handler: async (context: Omit<PluginEndpointContext, "ctx">) =>
        binding.handler({
          ...context,
          ctx: await service.resolveContext({ request: context.request }),
        }),
    }));
}

/** Descriptor identity is scoped to the service or resource installation host. */
export function installPlugin(
  service: Service<any, any>,
  resource: Resource<any, any, any> | undefined,
  descriptor: ServicePlugin<any, any> | ResourcePlugin<any, any, any>,
) {
  if (service.isBuilt)
    throw new Error("Plugins must be installed before service build");
  if (descriptor[pluginKind] !== (resource ? "resource" : "service"))
    throw new Error("Plugin does not support this installation host");
  const state = stateOf(service);
  const host = resource ?? service;
  const existing = state.hosts.get(host)?.get(descriptor.name);
  if (existing) {
    if (existing.status === "installing")
      throw new Error(`Plugin dependency cycle at '${descriptor.name}'`);
    if (existing.descriptor !== descriptor)
      throw new Error(
        `Plugin '${descriptor.name}' already installed with a different descriptor; reuse the original descriptor`,
      );
    return resource ?? existing.api;
  }
  const snapshots = {
    actions: new Map(service.actions),
    tools: new Map(service.tools),
    tables: new Map(service.tables),
    resources: new Map(service.resources),
    hosts: new Map(
      [...state.hosts].map(([key, installations]) => [
        key,
        new Map(installations),
      ]),
    ),
    bindings: new Map(state.actions),
    endpoints: [...state.endpoints],
    properties: new Map(
      [...service.resources.values()].map((item) => [
        item,
        Object.getOwnPropertyDescriptors(item),
      ]),
    ),
  };
  const installations =
    state.hosts.get(host) ?? new Map<string, Installation>();
  state.hosts.set(host, installations);
  installations.set(descriptor.name, { descriptor, status: "installing" });
  const names = new Set<string>();
  const ownedActions = new Set<Action<any, any, any, any>>();
  let active = true;
  const bindingFor = (config: {
    name: string;
    path: string;
    method: PluginRouteMethod;
    scope?: PluginRouteScope;
  }): Binding => {
    if (!active || service.isBuilt)
      throw new Error("Plugin routes can only be registered during setup");
    validateName(config.name);
    validatePath(config.path);
    if (names.has(config.name))
      throw new Error(`Duplicate plugin route name '${config.name}'`);
    names.add(config.name);
    const control =
      descriptor.routes === false ? false : descriptor.routes?.[config.name];
    const scope =
      (control && control.scope) ||
      config.scope ||
      (resource ? "resource" : "service");
    if (scope === "resource" && !resource)
      throw new Error("Service plugin routes cannot use resource scope");
    if (!["app", "service", "resource"].includes(scope))
      throw new Error(`Invalid plugin route scope '${scope}'`);
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(config.method))
      throw new Error(`Invalid plugin route method '${config.method}'`);
    const path = (control && control.path) || config.path;
    validatePath(path);
    return {
      service,
      resource,
      path,
      method: config.method,
      scope,
      enabled: control !== false,
    };
  };
  const routes: PluginRouteRegistrar<any> = {
    action(config: any) {
      const binding = bindingFor(config);
      for (const match of binding.path.matchAll(/:([A-Za-z0-9_]+)/g)) {
        if (
          !config.input?.properties ||
          !Object.hasOwn(config.input.properties, match[1]!)
        )
          throw new Error(
            `Plugin action path parameter '${match[1]}' must be declared in its input schema`,
          );
      }
      const name = `${resource ? `${resource.name}.` : ""}${descriptor.name}.${config.name}`;
      if (service.actions.has(name))
        throw new Error(`Duplicate plugin action '${name}'`);
      const { scope: _scope, ...actionConfig } = config;
      const action = defineAction({ ...actionConfig, name });
      service.action(action);
      ownedActions.add(action);
      state.actions.set(action, binding);
      actionBindings.set(action, binding);
      return action;
    },
    endpoint(config) {
      const binding = bindingFor(config);
      state.endpoints.push({
        ...binding,
        handler: config.handler,
        summary: config.summary,
        description: config.description,
        tags: config.tags,
      });
    },
  };
  try {
    const api = resource
      ? (descriptor as ResourcePlugin<any, any, any>).setup({
          service,
          resource,
          routes,
        })
      : (descriptor as ServicePlugin<any, any>).setup({ service, routes });
    if (api && typeof api === "object" && "then" in api)
      throw new Error("Plugin setup must be synchronous");
    if (
      descriptor.routes &&
      Object.keys(descriptor.routes).some((name) => !names.has(name))
    )
      throw new Error(
        `Plugin '${descriptor.name}' has an override for an unknown route`,
      );
    const walk = (value: unknown, path: string[], ancestors: Set<object>) => {
      if (typeof value === "function") {
        const binding = state.actions.get(value as Action<any, any, any, any>);
        if (binding && ownedActions.has(value as Action<any, any, any, any>)) {
          if (binding.clientPath)
            throw new Error("Plugin actions must have one returned API path");
          binding.clientPath = [resource?.name ?? service.name, ...path];
        }
      } else if (value && typeof value === "object" && !ancestors.has(value)) {
        const next = new Set(ancestors).add(value);
        for (const [key, child] of Object.entries(value))
          walk(child, [...path, key], next);
      }
    };
    walk(api, [], new Set());
    if (resource) {
      if (!api || typeof api !== "object" || Array.isArray(api))
        throw new Error("Resource plugins must return named API contributions");
      for (const key of Object.keys(api)) {
        if (
          key in resource ||
          ["__proto__", "prototype", "constructor"].includes(key)
        )
          throw new Error(
            `Resource plugin contribution '${key}' collides with an existing property`,
          );
      }
      Object.assign(resource, api);
    }
    state.hosts.get(host)!.set(descriptor.name, {
      descriptor,
      status: "installed",
      api,
    });
    getGlobalRegistry().touch();
    return resource ?? api;
  } catch (error) {
    for (const action of state.actions.keys())
      if (!snapshots.bindings.has(action)) actionBindings.delete(action);
    restoreMap(service.actions, snapshots.actions);
    restoreMap(service.tools, snapshots.tools);
    restoreMap(service.tables, snapshots.tables);
    restoreMap(service.resources, snapshots.resources);
    state.hosts = snapshots.hosts;
    state.actions = snapshots.bindings;
    state.endpoints = snapshots.endpoints;
    for (const [item, properties] of snapshots.properties) {
      for (const key of Reflect.ownKeys(item))
        if (!Object.hasOwn(properties, key)) Reflect.deleteProperty(item, key);
      Object.defineProperties(item, properties);
    }
    getGlobalRegistry().touch();
    throw error;
  } finally {
    active = false;
  }
}
function restoreMap<K, V>(target: Map<K, V>, snapshot: Map<K, V>) {
  target.clear();
  for (const [key, value] of snapshot) target.set(key, value);
}
