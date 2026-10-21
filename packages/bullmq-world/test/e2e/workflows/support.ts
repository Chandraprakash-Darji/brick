/**
 * Helpers a step body can use to leave evidence in Redis. The e2e server
 * (server/server.mts) installs `globalThis.__e2e` before it serves any job, and
 * steps run in the server's own process, so they can reach it. This module is
 * only ever evaluated by a step body, never by the workflow sandbox.
 */
export interface E2EHooks {
  /** HINCRBY key field 1, returns the new count. */
  count(key: string, field: string): Promise<number>;
}

export function e2e(): E2EHooks {
  const hooks = (globalThis as { __e2e?: E2EHooks }).__e2e;
  if (!hooks)
    throw new Error(
      "globalThis.__e2e is not installed (server.mts not in use?)",
    );
  return hooks;
}

export const sleepMs = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
