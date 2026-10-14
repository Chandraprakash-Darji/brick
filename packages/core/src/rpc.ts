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
            serviceName,
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

/** Keep caller fields while the receiving service owns its framework context. */
export function createRpcEnvelope(
  serviceName: string,
  defaultContext?: Partial<ActionContext>,
  callContext?: Partial<ActionContext>,
): Partial<ActionContext> {
  const envelope = {
    ...pickContextEnvelope(defaultContext),
    ...pickContextEnvelope(callContext),
  } as Partial<ActionContext> & { caller?: string };
  // Set caller to the originating service if not already set
  envelope.caller ??= serviceName;
  return envelope;
}
