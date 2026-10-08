import {
  getGlobalRegistry,
  type Action,
  type Resource,
  type Service,
} from "@brickkit/core";
import { brick, type CreateServerOptions } from "./server";
import type { BrickApp } from "./endpoints";

/**
 * Options for {@link brickFromContract}: everything `brick()` accepts except
 * `services`, which is derived from the contract itself.
 */
export type BrickFromContractOptions = Omit<CreateServerOptions, "services">;

function isAction(value: unknown): value is Action<any, any, any, any> {
  return (
    typeof value === "function" &&
    !!(value as any).config &&
    typeof (value as any).config.execute === "function"
  );
}

function isService(value: unknown): value is Service<any, any> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as any).listActions === "function" &&
    (value as any).actions instanceof Map
  );
}

function isResource(value: unknown): value is Resource<any, any> {
  return (
    !!value &&
    typeof value === "object" &&
    !isService(value) &&
    !!(value as any).actions &&
    typeof (value as any).actions === "object"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Collects definitions to resolve services; each service registers its own HTTP actions. */
function collectActions(
  node: unknown,
  out: Action<any, any, any, any>[],
): void {
  if (isAction(node)) {
    out.push(node);
    return;
  }
  if (isService(node)) {
    out.push(...node.listActions(), ...(node.listTools?.() ?? []));
    return;
  }
  if (isResource(node)) {
    out.push(...Object.values(node.actions));
    return;
  }
  if (isPlainObject(node)) {
    for (const value of Object.values(node)) collectActions(value, out);
  }
}

/**
 * Contract-first server: builds the `brick()` app from the same contract
 * object that types the frontend client, so services are declared once.
 *
 * ```ts
 * // server.ts (backend, single source of truth)
 * export const contract = defineAppContract({
 *   page: { list: listPages, create: createPage },
 *   billing: { charge: chargeAction },
 * });
 * export type AppServer = typeof contract;
 *
 * export const app = brickFromContract(contract, { port: 4000 });
 * ```
 *
 * ```ts
 * // frontend (type-only import, erased at build)
 * import type { AppServer } from "./server";
 * const api = createBrickClient<AppServer>({ baseUrl: "http://localhost:4000" });
 * ```
 *
 * Services are resolved through the global registry by each action's
 * `serviceName`, so every definition in the contract must be bound to a service
 * (via `service.action(...)` or `service.tool(...)`). Only HTTP actions
 * registered on that service produce routes. An
 * error names the offending action when it is unbound or its service was
 * never registered.
 */
export function brickFromContract<TContract extends Record<string, any>>(
  contract: TContract,
  options: BrickFromContractOptions = {},
): BrickApp {
  if (!contract || typeof contract !== "object") {
    throw new Error(
      "[Brick-TS] brickFromContract: `contract` must be an object of actions, resources, or services.",
    );
  }

  const actions: Action<any, any, any, any>[] = [];
  collectActions(contract, actions);
  if (actions.length === 0) {
    throw new Error(
      "[Brick-TS] brickFromContract: contract contains no actions.",
    );
  }

  const unbound = actions.filter((action) => !action.serviceName);
  if (unbound.length > 0) {
    throw new Error(
      `[Brick-TS] brickFromContract: actions not bound to a service (define them via service.action(...)): ${unbound.map((action) => `'${action.name}'`).join(", ")}.`,
    );
  }

  const services: Service<any, any>[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    const name = action.serviceName!;
    if (seen.has(name)) continue;
    seen.add(name);
    const service = getGlobalRegistry().get(name);
    if (!service) {
      throw new Error(
        `[Brick-TS] brickFromContract: service '${name}' (used by action '${action.name}') is not registered.`,
      );
    }
    services.push(service);
  }

  return brick({ ...options, services });
}
