import { createHook } from "workflow";

/** Scenario 6: wait for a payload on a hook with a caller-chosen token. */
export async function waitForHook(token: string) {
  "use workflow";
  const hook = createHook<{ message: string; n: number }>({ token });
  const payload = await hook;
  return { payload };
}

/**
 * Scenario 6 (conflict): the first run to claim the token waits on it; a run
 * that finds the token already owned reports who owns it instead of waiting.
 */
export async function claimHook(token: string) {
  "use workflow";
  using hook = createHook<{ message: string }>({ token });
  const conflict = await hook.getConflict();
  if (conflict) return { conflictWith: conflict.runId };
  const payload = await hook;
  return { payload };
}

/** Scenario 6 (conflict, no getConflict): the SDK's default surfacing of a conflict. */
export async function awaitHookDirectly(token: string) {
  "use workflow";
  const hook = createHook<{ message: string }>({ token });
  const payload = await hook;
  return { payload };
}

/**
 * Scenario 6d: a hook is a stream of payloads. Collect `expected` of them in
 * delivery order, then finish. Used with many concurrent resumeHook() calls.
 */
export async function collectHook(token: string, expected: number) {
  "use workflow";
  const hook = createHook<{ i: number }>({ token });
  const received: number[] = [];
  for await (const payload of hook) {
    received.push(payload.i);
    if (received.length >= expected) break;
  }
  return { received };
}
