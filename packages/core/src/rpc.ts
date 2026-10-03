import type { ActionContext, ProxyOptions } from "./types";
import { getGlobalRegistry } from "./registry";

export function createServiceProxy<T extends Record<string, any>>(
  serviceName: string,
  options: ProxyOptions = {}
): T {
  const isMonolith = options.isMonolith ?? true;

  return new Proxy({} as T, {
    get(_, actionName: string) {
      return async (payload: any, callCtx?: Partial<ActionContext>) => {
        if (isMonolith) {
          const registry = getGlobalRegistry();
          const service = registry.get(serviceName);
          if (!service) {
            throw new Error(`[Brick-TS RPC] Service '${serviceName}' is not registered in the local runtime.`);
          }

          const action = service.getAction(actionName);
          if (!action) {
            throw new Error(`[Brick-TS RPC] Action '${actionName}' does not exist on service '${serviceName}'.`);
          }

          const mergedCtx = {
            ...options.context,
            ...callCtx,
          };

          if (!mergedCtx.db && service.getDb()) {
            mergedCtx.db = service.getDb();
          }

          return action.execute({
            input: payload,
            ctx: mergedCtx,
          });
        } else {
          throw new Error(
            `[Brick-TS RPC] Remote microservice dispatch for '${serviceName}.${actionName}' is not yet configured for this environment.`
          );
        }
      };
    },
  });
}
