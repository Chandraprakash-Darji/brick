import type { ActionContext, ProxyOptions } from "./types";
import { getGlobalRegistry } from "./registry";

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

          // Build envelope context: exclude dangerous framework fields
          // This prevents the caller's database, providers, and resolver from overriding the receiving service's
          const dangerousFields = new Set([
            "db",
            "request",
            "logger",
            "services",
            "metadata",
            "_resolved",
          ]);

          const envelopeCtx: any = {};

          // Merge safe fields from options.context (if present)
          if (options.context) {
            for (const [key, value] of Object.entries(options.context)) {
              if (!dangerousFields.has(key)) {
                envelopeCtx[key] = value;
              }
            }
          }

          // Merge safe fields from callCtx (callCtx overrides options.context)
          if (callCtx) {
            for (const [key, value] of Object.entries(callCtx)) {
              if (!dangerousFields.has(key)) {
                envelopeCtx[key] = value;
              }
            }
          }

          // Set caller to the originating service if not already set
          if (!envelopeCtx.caller) {
            envelopeCtx.caller = serviceName;
          }

          return action.execute({
            input: payload,
            ctx: envelopeCtx,
          });
        } else {
          throw new Error(
            `[Brick-TS RPC] Remote microservice dispatch for '${serviceName}.${actionName}' is not yet configured for this environment.`,
          );
        }
      };
    },
  });
}
