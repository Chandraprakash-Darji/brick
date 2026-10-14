import type { ActionContext, ProxyOptions } from "./types";
import { getGlobalRegistry } from "./registry";
import { pickContextEnvelope } from "./context";

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

          return action.execute({
            input: payload,
            ctx: envelopeCtx,
          });
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
