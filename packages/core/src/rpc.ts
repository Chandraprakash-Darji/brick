import type { ActionContext, ProxyOptions } from "./types";
import { getGlobalRegistry } from "./registry";
import { pickContextEnvelope } from "./context";
import { withCallSpan } from "./telemetry";

/**
 * A typed way to call another service's actions in-process. Each property of
 * the proxy is an action of that service: call it with the action's input, and
 * optionally a call context.
 *
 * The call runs through the target's own validation and authorization, with the
 * target's database and context (never the caller's), and shows as an `rpc`
 * span in the trace. Only in-process dispatch exists: with `isMonolith: false`
 * a call throws. Use the typed client to call a service over HTTP.
 *
 * @param serviceName - The registered name of the service to call.
 * @param options - `from` (the calling service's name, which becomes `ctx.caller`
 * in the target and cannot be spoofed), `context` (defaults for every call), and
 * `isMonolith`.
 * @returns A proxy typed as `T`, usually the target's actions.
 * @throws On a call, when the service or the action is not registered.
 * @example
 * import { createServiceProxy } from "@brickkit/core";
 *
 * const pages = createServiceProxy<{ get(input: { id: string }): Promise<Page> }>(
 *   "pages",
 *   { from: "billing" },
 * );
 * const page = await pages.get({ id: "p_1" });
 */
export function createServiceProxy<T extends Record<string, any>>(
  serviceName: string,
  options: ProxyOptions = {},
): T {
  const isMonolith = options.isMonolith ?? true;

  return new Proxy({} as T, {
    get(_, actionName: string) {
      return async (payload: any, callCtx?: Partial<ActionContext>) => {
        if (isMonolith) {
          const registry = getGlobalRegistry();
          const service = registry.get(serviceName);
          if (!service) {
            throw new Error(
              `[Brick-TS RPC] Service '${serviceName}' is not registered in the local runtime.`,
            );
          }

          const action = service.getAction(actionName);
          if (!action) {
            throw new Error(
              `[Brick-TS RPC] Action '${actionName}' does not exist on service '${serviceName}'.`,
            );
          }

          const envelopeCtx = createRpcEnvelope(
            options.from,
            options.context,
            callCtx,
          );

          const execute = () =>
            action.execute({
              input: payload,
              ctx: envelopeCtx,
            });
          return withCallSpan(
            `rpc ${serviceName}.${actionName}`,
            {
              "brick.service": serviceName,
              "brick.action": actionName,
            },
            execute,
          );
        } else {
          throw new Error(
            `[Brick-TS RPC] Remote microservice dispatch for '${serviceName}.${actionName}' is not configured. Use createClient({ baseUrl, contract }) for HTTP calls to remote services.`,
          );
        }
      };
    },
  });
}

/** Build the trusted envelope for a proxy call.
 *
 * When `from` is provided, it identifies the service that created the proxy
 * and always sets `caller` — any `caller` supplied via `options.context` or
 * the per-call context is ignored so it cannot be spoofed. When `from` is
 * omitted, an explicitly supplied `caller` still passes through for backward
 * compatibility; otherwise `caller` stays unset (never the target service).
 */
export function createRpcEnvelope(
  from: string | undefined,
  defaultContext?: Partial<ActionContext>,
  callContext?: Partial<ActionContext>,
): Partial<ActionContext> {
  const envelope = {
    ...pickContextEnvelope(defaultContext),
    ...pickContextEnvelope(callContext),
  } as Partial<ActionContext> & { caller?: string };
  // `caller` identifies the service that created this proxy, never the target.
  // A configured `from` wins over any supplied value; without `from` we keep
  // an explicitly supplied caller (legacy) and otherwise leave it unset.
  if (from !== undefined) {
    envelope.caller = from;
  }
  return envelope;
}
