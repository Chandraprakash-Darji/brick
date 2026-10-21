import { getStepMetadata, sleep } from "workflow";
import { e2e, sleepMs } from "./support.js";

async function stamp(label: string): Promise<{ label: string; at: number }> {
  "use step";
  return { label, at: Date.now() };
}

/** Scenario 3: durable sleep, then a step. */
export async function sleepThenStep(duration: string) {
  "use workflow";
  const before = await stamp("before");
  await sleep(duration as `${number}s`);
  const after = await stamp("after");
  return { before: before.at, after: after.at };
}

async function mark(counterKey: string, field: string): Promise<number> {
  "use step";
  const meta = getStepMetadata();
  const n = await e2e().count(counterKey, field);
  await e2e().count(
    `${counterKey}:meta`,
    `${field}#${n} step=${meta.stepId} attempt=${meta.attempt}`,
  );
  return n;
}

/**
 * Scenarios 12, 13, 14: a run that spends most of its life suspended. A step,
 * a sleep, a step, a sleep, a step. Every step body counts itself, so a test
 * can see how often each one executed.
 */
export async function sleepyRun(duration: string, counterKey: string) {
  "use workflow";
  await mark(counterKey, "first");
  await sleep(duration as `${number}s`);
  await mark(counterKey, "second");
  await sleep(duration as `${number}s`);
  await mark(counterKey, "third");
  return "done";
}

async function slow(ms: number, counterKey: string): Promise<number> {
  "use step";
  const executions = await e2e().count(counterKey, "slow");
  await sleepMs(ms);
  return executions;
}

/** Scenario 11: one long step, so a worker can be killed while inside it. */
export async function slowStep(ms: number, counterKey: string) {
  "use workflow";
  await mark(counterKey, "before");
  const executions = await slow(ms, counterKey);
  await mark(counterKey, "after");
  return { executions };
}
