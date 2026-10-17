import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { Env } from "./harness/env.js";
import { W } from "./harness/workflows.js";

/** Mirror of makeBlob() in workflows/payloads.ts. */
function makeBlob(size: number, seed: number): string {
  let state = seed >>> 0 || 1;
  const chars = Array.from<string>({ length: size });
  for (let i = 0; i < size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    chars[i] = String.fromCharCode(33 + ((state >>> 24) % 90));
  }
  return chars.join("");
}

describe("single worker", () => {
  test(
    "1. fan-out of 50 steps: sum, dense log, one created/completed per step",
    { timeout: 180_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const n = 50;
      const runId = await env.invoke(W.fanOut, [n]);
      await env.waitForRuns([runId]);

      expect(await env.output(runId)).toBe(2 * ((n * (n - 1)) / 2));

      const events = await env.expectDenseLog(runId);
      const counts = Env.countByType(events);
      expect(counts.run_created).toBe(1);
      expect(counts.run_completed).toBe(1);
      expect(counts.step_created).toBe(n);
      expect(counts.step_completed).toBe(n);
      // Exactly one of each per step, keyed by the step's correlation id.
      for (const type of ["step_created", "step_completed"] as const) {
        const ids = events
          .filter((e) => e.eventType === type)
          .map((e) => e.correlationId);
        expect(new Set(ids).size, `${type} correlation ids are distinct`).toBe(
          n,
        );
      }
      env.expectCleanWorkerLogs();
    },
  );

  test("2. sequential chain of 30 steps", { timeout: 180_000 }, async () => {
    const env = await Env.create({ workers: 1 });
    const runId = await env.invoke(W.chain, [30]);
    await env.waitForRuns([runId]);

    expect(await env.output(runId)).toBe(30);
    const events = await env.expectDenseLog(runId);
    const counts = Env.countByType(events);
    expect(counts.step_created).toBe(30);
    expect(counts.step_completed).toBe(30);
    expect(counts.run_completed).toBe(1);
    env.expectCleanWorkerLogs();
  });

  test(
    "3. sleep('2s') then a step: completes, and took at least 2s",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const startedAt = Date.now();
      const runId = await env.invoke(W.sleepThenStep, ["2s"]);
      await env.waitForRuns([runId]);
      const wallMs = Date.now() - startedAt;

      const out = await env.output<{ before: number; after: number }>(runId);
      expect(
        out.after - out.before,
        "step timestamps straddle the sleep",
      ).toBeGreaterThanOrEqual(2000);
      expect(
        wallMs,
        "wall clock from invoke to completed",
      ).toBeGreaterThanOrEqual(2000);

      const run = await env.getRun(runId);
      expect(
        run.completedAt!.getTime() - run.createdAt.getTime(),
        "run createdAt..completedAt",
      ).toBeGreaterThanOrEqual(2000);

      const counts = Env.countByType(await env.expectDenseLog(runId));
      expect(counts.wait_created).toBe(1);
      expect(counts.wait_completed).toBe(1);
      expect(counts.run_completed).toBe(1);
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "4. RetryableError on attempts 1 and 2, success on 3",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const startedAt = Date.now();
      const runId = await env.invoke(W.retryThenSucceed, []);
      await env.waitForRuns([runId]);
      const wallMs = Date.now() - startedAt;

      expect(await env.output(runId)).toEqual({ attempt: 3 });
      // Two retryAfter delays of 1s each must have been honored.
      expect(wallMs, "two 1s retryAfter delays").toBeGreaterThanOrEqual(2000);

      const steps = await env.world.steps.list({ runId, resolveData: "none" });
      expect(steps.data).toHaveLength(1);
      expect(steps.data[0]).toMatchObject({ status: "completed", attempt: 3 });

      const counts = Env.countByType(await env.expectDenseLog(runId));
      expect(counts.step_created).toBe(1);
      expect(counts.step_started).toBe(3);
      expect(counts.step_retrying).toBe(2);
      expect(counts.step_completed).toBe(1);
      expect(counts.run_completed).toBe(1);
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "5. FatalError in a step fails the run; code and message survive",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const marker = `fatal-marker-${randomBytes(4).toString("hex")}`;
      const runId = await env.invoke(W.fatal, [marker]);
      await env.waitForRuns([runId], "failed");

      const { errorCode, error } = await env.runError(runId);
      expect(errorCode).toBe("USER_ERROR");
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(marker);

      // The same, through the SDK's `run.returnValue` rejection.
      const result = await env.result(runId);
      expect(result).toMatchObject({
        status: "failed",
        errorCode: "USER_ERROR",
      });
      expect(JSON.stringify(result.cause)).toContain(marker);

      const counts = Env.countByType(await env.expectDenseLog(runId));
      expect(counts.step_failed).toBe(1);
      expect(counts.step_retrying ?? 0).toBe(0);
      expect(counts.run_failed).toBe(1);
      expect(counts.run_completed ?? 0).toBe(0);
    },
  );

  test(
    "6a. hook: the payload round-trips after the run is suspended",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const token = `tok-${env.id}-a`;
      const runId = await env.invoke(W.waitForHook, [token]);

      // Suspended: the hook is registered and nothing else will happen on its own.
      await env.until("hook_created event", async () =>
        (await env.events(runId)).some((e) => e.eventType === "hook_created")
          ? true
          : undefined,
      );
      expect(await env.status(runId)).toBe("running");

      const payload = { message: "hello ✓ é", n: 42 };
      const [worker] = env.liveWorkers();
      await worker!.fetchJson(`/hooks/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      await env.waitForRuns([runId]);

      expect(await env.output(runId)).toEqual({ payload });
      const counts = Env.countByType(await env.expectDenseLog(runId));
      expect(counts.hook_created).toBe(1);
      expect(counts.hook_received).toBe(1);
      expect(counts.run_completed).toBe(1);
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "6b. hook: a second run with the same token observes the conflict",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const token = `tok-${env.id}-b`;
      const first = await env.invoke(W.claimHook, [token]);
      await env.until("first run registers the hook", async () =>
        (await env.events(first)).some((e) => e.eventType === "hook_created")
          ? true
          : undefined,
      );

      const second = await env.invoke(W.claimHook, [token]);
      await env.waitForRuns([second]);
      expect(await env.output(second)).toEqual({ conflictWith: first });
      const secondCounts = Env.countByType(await env.expectDenseLog(second));
      expect(secondCounts.hook_conflict).toBe(1);
      expect(secondCounts.hook_created ?? 0).toBe(0);

      // The first run still owns the token and still completes through it.
      expect(await env.status(first)).toBe("running");
      const [worker] = env.liveWorkers();
      await worker!.fetchJson(`/hooks/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "for the owner" }),
      });
      await env.waitForRuns([first]);
      expect(await env.output(first)).toEqual({
        payload: { message: "for the owner" },
      });
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "6c. hook: awaiting a conflicted hook directly fails the second run",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const token = `tok-${env.id}-c`;
      const first = await env.invoke(W.awaitHookDirectly, [token]);
      await env.until("first run registers the hook", async () =>
        (await env.events(first)).some((e) => e.eventType === "hook_created")
          ? true
          : undefined,
      );

      const second = await env.invoke(W.awaitHookDirectly, [token]);
      await env.waitForRuns([second], "failed");
      const result = await env.result(second);
      expect(result.status).toBe("failed");
      expect(`${result.message} ${JSON.stringify(result.cause)}`).toMatch(
        /hook|token|conflict/i,
      );
      expect(
        (await env.expectDenseLog(second)).some(
          (e) => e.eventType === "hook_conflict",
        ),
      ).toBe(true);
    },
  );

  test(
    "6d. hook: 30 concurrent resumeHook() calls are each delivered exactly once",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const token = `tok-${env.id}-d`;
      const total = 30;
      const runId = await env.invoke(W.collectHook, [token, total]);
      await env.until("hook_created event", async () =>
        (await env.hasEvent(runId, "hook_created")) ? true : undefined,
      );

      const [worker] = env.liveWorkers();
      const responses = await Promise.allSettled(
        Array.from({ length: total }, (_, i) =>
          worker!.fetchJson(`/hooks/${token}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ i }),
          }),
        ),
      );
      expect(
        responses
          .filter((r) => r.status === "rejected")
          .map((r) => String((r as PromiseRejectedResult).reason)),
      ).toEqual([]);
      await env.waitForRuns([runId]);

      const { received } = await env.output<{ received: number[] }>(runId);
      expect(
        [...received].sort((a, b) => a - b),
        "every payload exactly once",
      ).toEqual(Array.from({ length: total }, (_, i) => i));
      const events = await env.expectDenseLog(runId);
      expect(Env.countByType(events).hook_received).toBe(total);
      expect(Env.countByType(events).run_completed).toBe(1);
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "7. stream: 100 chunks written by a step are read back in order",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const count = 100;
      const runId = await env.invoke(W.streamChunks, [count]);
      await env.waitForRuns([runId]);

      const [worker] = env.liveWorkers();
      const { closed, chunks } = await worker!.fetchJson<{
        closed: boolean;
        chunks: string[];
      }>(`/runs/${runId}/chunks`);
      const expected = Array.from(
        { length: count },
        (_, i) => `chunk-${String(i).padStart(4, "0")}\n`,
      );
      expect(closed, "the stream is closed once the run completed").toBe(true);
      expect(chunks.join("")).toBe(expected.join(""));
      expect(chunks).toEqual(expected);

      // The world's own view of the stored chunks agrees.
      const [name] = await env.world.streams.list(runId);
      expect(name).toBeDefined();
      const info = await env.world.streams.getInfo(runId, name!);
      expect(info.done).toBe(true);
      expect(info.tailIndex).toBe(count - 1);
      env.expectCleanWorkerLogs();
    },
  );

  // Informational: the streaming docs say streams are "automatically closed
  // when the workflow run completes". No first-party World does this itself
  // (world-local and world-postgres do not either), so only the chunk content
  // is asserted; whether the stream closed is logged.
  test(
    "7b. stream left open by the workflow: chunks are still all readable",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const runId = await env.invoke(W.streamChunks, [20, false]);
      await env.waitForRuns([runId]);
      const [worker] = env.liveWorkers();
      const { closed, chunks } = await worker!.fetchJson<{
        closed: boolean;
        chunks: string[];
      }>(`/runs/${runId}/chunks?timeoutMs=5000`);
      console.log(
        `[7b] stream closed after run completion without an explicit close: ${closed}`,
      );
      expect(chunks).toEqual(
        Array.from(
          { length: 20 },
          (_, i) => `chunk-${String(i).padStart(4, "0")}\n`,
        ),
      );
    },
  );

  test(
    "8. large payloads: ~3 MB step input and ~3 MB step output round-trip intact",
    { timeout: 180_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const size = 3 * 1024 * 1024;
      const blob = randomBytes(size / 2).toString("hex"); // 3 MiB of text
      expect(blob.length).toBe(size);
      const seed = 1234567;
      const runId = await env.invoke(W.bigRoundTrip, [blob, size, seed]);
      await env.waitForRuns([runId], "completed", 150_000);

      const out = await env.output<{ echoed: string; made: string }>(runId);
      expect(out.echoed.length).toBe(size);
      expect(
        out.echoed === blob,
        "step input came back byte-identical as the step output",
      ).toBe(true);
      expect(out.made.length).toBe(size);
      expect(
        out.made === makeBlob(size, seed),
        "a 3 MB value produced inside a step survived",
      ).toBe(true);

      const counts = Env.countByType(await env.expectDenseLog(runId));
      expect(counts.step_created).toBe(2);
      expect(counts.step_completed).toBe(2);
      expect(counts.run_completed).toBe(1);
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "9. 100 concurrent small runs all complete, every log dense",
    { timeout: 300_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const total = 100;
      const runIds = await env.invokeMany(total, W.tiny, (i) => [i]);
      expect(new Set(runIds).size).toBe(total);
      await env.waitForRuns(runIds, "completed", 240_000);

      for (const [i, runId] of runIds.entries()) {
        expect(await env.output(runId), `run ${i} output`).toBe(i + 3);
        const events = await env.expectDenseLog(runId);
        const counts = Env.countByType(events);
        expect(counts.step_created, `run ${i} step_created`).toBe(3);
        expect(counts.step_completed, `run ${i} step_completed`).toBe(3);
        expect(counts.run_completed, `run ${i} run_completed`).toBe(1);
      }
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "9b. the same runKey started twice is one run: one id, one run_created, steps run once",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 1 });
      const counterKey = env.counterKey("same-key");
      const options = {
        runKey: "evt_01:welcome-email",
        runKeyTime: Date.UTC(2026, 9, 17, 12, 30, 0),
      };
      const first = await env.invoke(
        W.fanOut,
        [5, counterKey],
        undefined,
        options,
      );
      const second = await env.invoke(
        W.fanOut,
        [5, counterKey],
        undefined,
        options,
      );
      expect(second).toBe(first);
      expect(first).toMatch(/^wrun_[0-9A-HJKMNP-TV-Z]{26}$/);
      await env.waitForRuns([first]);
      expect(await env.output(first)).toBe(20);

      const counts = await env.counts(counterKey);
      expect(Object.keys(counts)).toHaveLength(5);
      expect(Object.values(counts).filter((count) => count !== 1)).toEqual([]);

      const byType = Env.countByType(await env.expectDenseLog(first));
      expect(byType.run_created).toBe(1);
      expect(byType.run_completed).toBe(1);
      env.expectCleanWorkerLogs();
    },
  );
});
