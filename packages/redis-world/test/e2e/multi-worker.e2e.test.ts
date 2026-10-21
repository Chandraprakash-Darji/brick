import { describe, expect, test } from "vitest";
import { Env } from "./harness/env.js";
import { W } from "./harness/workflows.js";

describe("multi worker (3 processes, one Redis, shared prefixes)", () => {
  test(
    "10. 60 fan-out runs: all complete, each step body runs exactly once, no duplicate terminal event",
    { timeout: 600_000 },
    async () => {
      const env = await Env.create({ workers: 3 });
      expect(env.liveWorkers()).toHaveLength(3);
      const total = 60;
      const n = 50;
      const keys = Array.from({ length: total }, (_, i) =>
        env.counterKey(`run${i}`),
      );
      const runIds = await env.invokeMany(total, W.fanOut, (i) => [n, keys[i]]);
      expect(new Set(runIds).size).toBe(total);
      await env.waitForRuns(runIds, "completed", 480_000);

      const expectedSum = n * (n - 1);
      const workersThatExecutedSteps = new Set<string>();
      for (const [i, runId] of runIds.entries()) {
        expect(await env.output(runId), `run ${i} output`).toBe(expectedSum);

        // Every step body ran exactly once: n fields, each counted 1.
        const counts = await env.counts(keys[i]!);
        expect(
          Object.keys(counts),
          `run ${i}: steps that executed`,
        ).toHaveLength(n);
        const notOnce = Object.entries(counts).filter(([, c]) => c !== 1);
        expect(
          notOnce,
          `run ${i}: step bodies that did not run exactly once`,
        ).toEqual([]);
        for (const worker of Object.values(await env.executions(keys[i]!)))
          workersThatExecutedSteps.add(worker);

        const events = await env.expectDenseLog(runId);
        const byType = Env.countByType(events);
        expect(byType.run_created, `run ${i} run_created`).toBe(1);
        expect(byType.run_completed, `run ${i} run_completed`).toBe(1);
        expect(byType.run_failed ?? 0, `run ${i} run_failed`).toBe(0);
        expect(byType.run_cancelled ?? 0, `run ${i} run_cancelled`).toBe(0);
        expect(byType.step_created, `run ${i} step_created`).toBe(n);
        expect(byType.step_completed, `run ${i} step_completed`).toBe(n);
        expect(byType.step_failed ?? 0, `run ${i} step_failed`).toBe(0);
        expect(byType.step_retrying ?? 0, `run ${i} step_retrying`).toBe(0);
        // The terminal event is the last event of the log.
        expect(events.at(-1)?.eventType, `run ${i} last event`).toBe(
          "run_completed",
        );
      }

      // The work really was spread: every worker accepted deliveries and ran step bodies.
      const deliveries = await env.deliveriesByWorker();
      console.log(
        `[10] deliveries per worker: ${JSON.stringify(deliveries)}; step bodies executed on: ${[...workersThatExecutedSteps].sort().join(",")}`,
      );
      for (const w of env.workers) {
        expect(
          deliveries[w.name],
          `worker ${w.name} accepted deliveries`,
        ).toBeGreaterThan(0);
      }
      expect(
        workersThatExecutedSteps.size,
        "more than one worker executed step bodies",
      ).toBeGreaterThan(1);
      env.expectCleanWorkerLogs();
    },
  );

  test(
    "10b. the same runKey started on three workers at once is one run",
    { timeout: 120_000 },
    async () => {
      const env = await Env.create({ workers: 3 });
      const counterKey = env.counterKey("same-key-race");
      const options = {
        runKey: "evt_02:welcome-email",
        runKeyTime: Date.UTC(2026, 9, 17, 12, 30, 0),
      };
      const runIds = await Promise.all(
        env
          .liveWorkers()
          .map((worker) =>
            env.invoke(W.fanOut, [5, counterKey], worker, options),
          ),
      );
      expect(new Set(runIds).size).toBe(1);
      const runId = runIds[0]!;
      await env.waitForRuns([runId]);
      expect(await env.output(runId)).toBe(20);

      const counts = await env.counts(counterKey);
      expect(Object.keys(counts)).toHaveLength(5);
      expect(Object.values(counts).filter((count) => count !== 1)).toEqual([]);

      const byType = Env.countByType(await env.expectDenseLog(runId));
      expect(byType.run_created).toBe(1);
      expect(byType.run_completed).toBe(1);
      env.expectCleanWorkerLogs();
    },
  );
});
