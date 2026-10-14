import { Effect } from "effect";
import { getGlobalRegistry } from "./registry";
import { createRpcEnvelope } from "./rpc";
import {
  createMcpRegistry,
  UnknownToolError,
  type McpRegistry,
  type McpRegistryOptions,
} from "./mcp";
import type { Action, ActionContext, ProxyOptions } from "./types";

type NativeProxy<T, R> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer O
    ? (
        ...args: A
      ) => O extends Effect.Effect<any, any, any>
        ? O
        : Effect.Effect<Awaited<O>, unknown, R>
    : never;
};

function executeNative<R>(
  action: Action<any, any, any, any>,
  params: { input?: unknown; ctx?: Partial<ActionContext> },
): Effect.Effect<unknown, unknown, R> {
  return Effect.suspend(() => {
    const execute = Reflect.get(action, "executeEffect");
    return typeof execute === "function"
      ? execute(params)
      : Effect.tryPromise({
          try: () => action.execute(params),
          catch: (error) => error,
        });
  });
}

/** Local dispatch stays in the caller's Effect environment and scope. */
export function createEffectServiceProxy<
  T extends Record<string, any>,
  R = never,
>(serviceName: string, options: ProxyOptions = {}): NativeProxy<T, R> {
  return new Proxy({} as NativeProxy<T, R>, {
    get(_, actionName: string) {
      return (payload: unknown, callCtx?: Partial<ActionContext>) =>
        Effect.suspend(() => {
          if (options.isMonolith === false)
            return Effect.fail(
              new Error(
                `[Brick-TS RPC] Remote microservice dispatch for '${serviceName}.${actionName}' is not yet configured for this environment.`,
              ),
            );
          const service = getGlobalRegistry().get(serviceName);
          if (!service)
            return Effect.fail(
              new Error(
                `[Brick-TS RPC] Service '${serviceName}' is not registered in the local runtime.`,
              ),
            );
          const action = service.getAction(actionName);
          if (!action)
            return Effect.fail(
              new Error(
                `[Brick-TS RPC] Action '${actionName}' does not exist on service '${serviceName}'.`,
              ),
            );
          return executeNative<R>(action, {
            input: payload,
            ctx: createRpcEnvelope(serviceName, options.context, callCtx),
          });
        });
    },
  });
}

export interface EffectMcpRegistry<R = never> extends McpRegistry {
  callToolEffect(
    name: string,
    args?: Record<string, unknown>,
    ctx?: Partial<ActionContext>,
  ): Effect.Effect<unknown, unknown, R>;
}

/** Native tool calls compose directly; the existing MCP Promise interface remains available. */
export function createEffectMcpRegistry<R = never>(
  options: McpRegistryOptions,
): EffectMcpRegistry<R> {
  const registry = createMcpRegistry(options);
  return {
    ...registry,
    callToolEffect: (name, args = {}, ctx) =>
      Effect.suspend(() => {
        // Reuse the base registry's duplicate-name validation, including later registrations.
        registry.listTools();
        const tool = [
          ...(options.tools ?? []),
          ...(options.services ?? []).flatMap((service) => service.listTools()),
        ].find((candidate) => candidate.name === name);
        return tool
          ? executeNative<R>(tool, { input: args, ctx })
          : Effect.fail(new UnknownToolError(name));
      }),
  };
}
