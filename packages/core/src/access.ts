import type { Action, ActionAccessPolicy } from "./types";

export type { ActionAccessPolicy };
export interface ActionAccessInfo {
  hasAuthorize: boolean;
  hasScope: boolean;
  policy: ActionAccessPolicy;
}

/**
 * Cross-copy access metadata protocol. CRUD enforces its access policy
 * inside `execute`, so `config.authorize` is absent and introspection
 * can't see it. The plugin stamps each action under this process-global
 * symbol; introspection and OpenAPI read it back. Uses `Symbol.for` so
 * the binding survives a second copy of core (bundler SSR, Vitest),
 * same as the plugin action-binding key.
 */
export const ACTION_ACCESS_KEY = Symbol.for("brickkit.action.access");

export function setActionAccess(action: object, info: ActionAccessInfo): void {
  (action as Record<symbol, ActionAccessInfo>)[ACTION_ACCESS_KEY] = {
    hasAuthorize: info.hasAuthorize,
    hasScope: info.hasScope,
    policy: info.policy,
  };
}

export function getActionAccess(action: Action | object): ActionAccessInfo {
  const meta = (action as Record<symbol, unknown>)[ACTION_ACCESS_KEY] as
    | Partial<ActionAccessInfo>
    | undefined;
  const configAuthorize = Boolean(
    (action as Action)?.config &&
    typeof (action as Action).config === "object" &&
    "authorize" in (action as Action).config &&
    typeof (action as Action).config.authorize === "function",
  );
  if (!meta) {
    return {
      hasAuthorize: configAuthorize,
      hasScope: false,
      policy: configAuthorize ? "authorized" : "public",
    };
  }
  const hasAuthorize = configAuthorize || Boolean(meta.hasAuthorize);
  const hasScope = Boolean(meta.hasScope);
  const policy: ActionAccessPolicy =
    meta.policy ??
    (hasAuthorize ? (hasScope ? "scoped" : "authorized") : "public");
  return { hasAuthorize, hasScope, policy };
}
