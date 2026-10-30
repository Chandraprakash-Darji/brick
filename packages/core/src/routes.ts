import type { Action, ResourceActionAccess } from "./types";
import { getPluginActionRoute } from "./plugin";
import { kebabCase } from "./kebab";

export { kebabCase };

/**
 * The route every name of an owner mounts under: `${prefix}`,
 * `${prefix}/${service}`, or `${prefix}/${service}/${resource}`, in kebab-case.
 */
export function ownerPath(
  prefix: string,
  service?: string,
  resource?: string,
): string {
  let path = prefix.replace(/\/$/, "");
  if (service !== undefined) path += `/${kebabCase(service)}`;
  if (resource !== undefined) path += `/${kebabCase(resource)}`;
  return path;
}

/** Joins a path relative to its owner. `/` is the owner's own route. */
export function joinRoute(base: string, path: string): string {
  return `${base}${path === "/" ? "" : path}` || "/";
}

export interface ActionRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** The v0.10 path, served too by `brick({ legacyRoutes: true })`. */
  legacyPath?: string;
}

/**
 * Where an action is served over HTTP: its method and its path under the owner
 * tree (`${prefix}/${service}/${action}`, a plugin's route, or a resource
 * action's `${prefix}/${service}/${resource}[/:id]/${action}`).
 *
 * @param action - An action registered on a service.
 * @param prefix - The application's route prefix (default `/api`).
 * @returns `false` when a plugin switched the route off, otherwise the route.
 */
export function getActionRoute(
  action: Action<any, any, any, any>,
  prefix = "/api",
): ActionRoute | false {
  const plugin = getPluginActionRoute(action, prefix);
  if (plugin === false) return false;
  if (plugin)
    return {
      method: plugin.method,
      path: plugin.path,
      legacyPath: plugin.legacyPath,
    };
  const service = action.serviceName ?? "";
  const method = action.config.method ?? "POST";
  const { resourceAction } = action as { resourceAction?: ResourceActionInfo };
  if (resourceAction) {
    const base = ownerPath(prefix, service, resourceAction.resource);
    return {
      method,
      path:
        action.config.path !== undefined
          ? joinRoute(base, action.config.path)
          : `${base}${resourceAction.record ? "/:id" : ""}/${kebabCase(resourceAction.name)}`,
    };
  }
  const base = ownerPath(prefix, service);
  return {
    method,
    path:
      action.config.path !== undefined
        ? joinRoute(base, action.config.path)
        : `${base}/${kebabCase(action.name)}`,
    legacyPath: legacyPath(prefix, service, action.name, action.config.path),
  };
}

/**
 * The v0.10 route of a service action or socket: the names as declared, or an
 * explicit path that still reads as absolute (it starts with the prefix). A
 * path already rewritten as relative has no v0.10 form.
 */
export function legacyPath(
  prefix: string,
  service: string,
  name: string,
  path: string | undefined,
): string | undefined {
  const root = prefix.replace(/\/$/, "");
  if (path === undefined) return `${root}/${service}/${name}`;
  return path.startsWith(`${root}/`) ? path : undefined;
}

/** Stamped on actions declared with `resource.action(...)`. */
export interface ResourceActionInfo {
  resource: string;
  /** The declared name, without the `resource.` prefix. */
  name: string;
  record: boolean;
  /** A record action's own access rule. */
  access?: ResourceActionAccess;
}
