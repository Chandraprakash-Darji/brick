import { randomUUID } from "node:crypto";
import { RedisContainer } from "@testcontainers/redis";
import { EntityConflictError, RunExpiredError } from "@workflow/errors";
import { eventIdToSlot, slotToEventId } from "@workflow/world";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import {
  createEventsStorage,
  createHooksStorage,
  createRunsStorage,
  createStepsStorage,
} from "../src/storage.js";

// The v5 spec makes an event id the event's position in its run's log. These
// tests pin the parts a type check cannot: slots are chosen at the commit, stay
// dense under concurrency, and a stale writer is bumped and told what it missed.
describe("slot-numbered event log (Redis integration)", () => {
  if (process.platform === "win32") {
    test.skip("skipped on Windows since it relies on a docker container", () => {});
    return;
  }

  let container: Awaited<ReturnType<RedisContainer["start"]>> | undefined;
  let redis: Redis;

  beforeAll(async () => {
    // REDIS_TEST_URL points the suite at an existing Redis instead of a container.
    const redisUrl =
      process.env.REDIS_TEST_URL ??
      (container = await new RedisContainer(
        "redis:7-alpine",
      ).start()).getConnectionUrl();
    redis = new Redis(redisUrl);
  }, 120_000);

  afterAll(async () => {
    await redis.quit();
    await container?.stop();
  });

  /** Fresh storage under a prefix of its own, so tests never see each other. */
  function createStorage() {
    const config = { redis, keyPrefix: `slots:${randomUUID()}:` };
    return {
      runs: createRunsStorage(config),
      steps: createStepsStorage(config),
      events: createEventsStorage(config),
      hooks: createHooksStorage(config),
    };
  }
  type Storage = ReturnType<typeof createStorage>;

  async function startRun(storage: Storage) {
    const created = await storage.events.create(null, {
      eventType: "run_created",
      eventData: { deploymentId: "d", workflowName: "w", input: [] },
    });
    const runId = created.run!.runId;
    await storage.events.create(runId, { eventType: "run_started" });
    return runId;
  }

  async function slotsOf(storage: Storage, runId: string) {
    const log = await storage.events.list({
      runId,
      pagination: { limit: 1000 },
    });
    return log.data.map((event) => eventIdToSlot(event.eventId));
  }

  it("numbers a run from slot 1 and keeps it dense", async () => {
    const storage = createStorage();
    const created = await storage.events.create(null, {
      eventType: "run_created",
      eventData: { deploymentId: "d", workflowName: "w", input: [] },
    });
    expect(created.event?.eventId).toBe(slotToEventId(1));
    const runId = created.run!.runId;

    const started = await storage.events.create(runId, {
      eventType: "run_started",
    });
    expect(started.event?.eventId).toBe(slotToEventId(2));
    expect(await slotsOf(storage, runId)).toEqual([1, 2]);
  });

  it("builds the same event ids as slotToEventId, across digit boundaries", async () => {
    // The ids are padded inside the Lua script, which cannot call slotToEventId.
    const storage = createStorage();
    const runId = await startRun(storage);
    for (let i = 0; i < 125; i++) {
      await storage.events.create(runId, {
        eventType: "step_created",
        correlationId: `step-${i}`,
        eventData: { stepName: "s", input: [] },
      });
    }
    const log = await storage.events.list({
      runId,
      pagination: { limit: 1000 },
    });
    expect(log.data.map((event) => event.eventId)).toEqual(
      Array.from({ length: 127 }, (_, i) => slotToEventId(i + 1)),
    );
  });

  it("does not reuse a slot across runs", async () => {
    const storage = createStorage();
    const [a, b] = await Promise.all([startRun(storage), startRun(storage)]);
    expect(await slotsOf(storage, a)).toEqual([1, 2]);
    expect(await slotsOf(storage, b)).toEqual([1, 2]);
  });

  it("keeps the log dense when many writers race for the same slot", async () => {
    const storage = createStorage();
    const runId = await startRun(storage);
    const writers = 40;

    // Every writer holds the same stale view: it has seen run_created and run_started.
    const results = await Promise.all(
      Array.from({ length: writers }, (_, i) =>
        storage.events.create(
          runId,
          {
            eventType: "step_created",
            correlationId: `step-${i}`,
            eventData: { stepName: "s", input: [] },
          },
          { eventCount: 2 },
        ),
      ),
    );

    // No write was refused, and no two writes took the same slot.
    const slots = results.map((result) =>
      eventIdToSlot(result.event!.eventId)!,
    );
    expect(new Set(slots).size).toBe(writers);
    expect([...slots].sort((x, y) => x - y)).toEqual(
      Array.from({ length: writers }, (_, i) => i + 3),
    );

    // The log has no holes.
    expect(await slotsOf(storage, runId)).toEqual(
      Array.from({ length: writers + 2 }, (_, i) => i + 1),
    );
  });

  it("reports the events a stale writer skipped over, and nothing else", async () => {
    const storage = createStorage();
    const runId = await startRun(storage);
    const writers = 12;

    const results = await Promise.all(
      Array.from({ length: writers }, (_, i) =>
        storage.events.create(
          runId,
          {
            eventType: "step_created",
            correlationId: `step-${i}`,
            eventData: { stepName: "s", input: [] },
          },
          { eventCount: 2 },
        ),
      ),
    );

    for (const result of results) {
      const landed = eventIdToSlot(result.event!.eventId)!;
      const reported = (result.events ?? []).map((event) =>
        eventIdToSlot(event.eventId),
      );
      // Exactly the slots between the one asked for (3) and the one landed on.
      expect(reported).toEqual(
        Array.from({ length: landed - 3 }, (_, i) => i + 3),
      );
      // A report is a lower bound, not a read to the end: it must not move the cursor.
      if (landed > 3) {
        expect(result.cursor).toBeNull();
        expect(result.hasMore).toBe(false);
      }
    }
  });

  it("reports nothing when the writer was current", async () => {
    const storage = createStorage();
    const runId = await startRun(storage);
    const result = await storage.events.create(
      runId,
      {
        eventType: "step_created",
        correlationId: "step-current",
        eventData: { stepName: "s", input: [] },
      },
      { eventCount: 2 },
    );
    expect(result.event?.eventId).toBe(slotToEventId(3));
    expect(result.events).toBeUndefined();
  });

  it("accepts a write that carries no eventCount", async () => {
    const storage = createStorage();
    const runId = await startRun(storage);
    await storage.events.create(runId, {
      eventType: "step_created",
      correlationId: "step-a",
      eventData: { stepName: "s", input: [] },
    });
    const result = await storage.events.create(runId, {
      eventType: "step_created",
      correlationId: "step-b",
      eventData: { stepName: "s", input: [] },
    });
    expect(result.event?.eventId).toBe(slotToEventId(4));
    expect(result.events).toBeUndefined();
  });

  it("returns an inline delta after sinceCursor that includes the write itself", async () => {
    const storage = createStorage();
    const runId = await startRun(storage);
    await storage.events.create(runId, {
      eventType: "step_created",
      correlationId: "step-a",
      eventData: { stepName: "s", input: [] },
    });

    // The writer last read slot 2; the delta is everything after it.
    const result = await storage.events.create(
      runId,
      {
        eventType: "step_created",
        correlationId: "step-b",
        eventData: { stepName: "s", input: [] },
      },
      { sinceCursor: slotToEventId(2), eventCount: 2 },
    );
    expect(result.events?.map((event) => eventIdToSlot(event.eventId))).toEqual(
      [3, 4],
    );
    expect(result.cursor).toBe(slotToEventId(4));
    expect(result.hasMore).toBe(false);
  });

  it("pages a run forward and backward by slot", async () => {
    const storage = createStorage();
    const runId = await startRun(storage);
    for (let i = 0; i < 5; i++) {
      await storage.events.create(runId, {
        eventType: "step_created",
        correlationId: `step-${i}`,
        eventData: { stepName: "s", input: [] },
      });
    }

    const first = await storage.events.list({
      runId,
      pagination: { limit: 3 },
    });
    expect(first.data.map((e) => eventIdToSlot(e.eventId))).toEqual([1, 2, 3]);
    expect(first.hasMore).toBe(true);

    const second = await storage.events.list({
      runId,
      pagination: { limit: 3, cursor: first.cursor! },
    });
    expect(second.data.map((e) => eventIdToSlot(e.eventId))).toEqual([4, 5, 6]);
    expect(second.hasMore).toBe(true);

    const third = await storage.events.list({
      runId,
      pagination: { limit: 3, cursor: second.cursor! },
    });
    expect(third.data.map((e) => eventIdToSlot(e.eventId))).toEqual([7]);
    expect(third.hasMore).toBe(false);

    const newest = await storage.events.list({
      runId,
      pagination: { limit: 3, sortOrder: "desc" },
    });
    expect(newest.data.map((e) => eventIdToSlot(e.eventId))).toEqual([7, 6, 5]);
    expect(newest.hasMore).toBe(true);
  });

  it("scopes a correlation id to its run", async () => {
    const storage = createStorage();
    const [a, b] = await Promise.all([startRun(storage), startRun(storage)]);
    for (const runId of [a, b]) {
      await storage.events.create(runId, {
        eventType: "step_created",
        correlationId: "step-1",
        eventData: { stepName: "s", input: [] },
      });
    }
    const forA = await storage.events.listByCorrelationId({
      runId: a,
      correlationId: "step-1",
    });
    expect(forA.data).toHaveLength(1);
    expect(forA.data[0].runId).toBe(a);
  });

  describe("lazy step start", () => {
    const lazyStart = (storage: Storage, runId: string, stepId: string) =>
      storage.events.create(runId, {
        eventType: "step_started",
        correlationId: stepId,
        eventData: { stepName: "lazy", input: new Uint8Array([1, 2, 3]) },
      });

    it("creates the step, a synthetic step_created, and the start together", async () => {
      const storage = createStorage();
      const runId = await startRun(storage);
      const result = await lazyStart(storage, runId, "step-lazy");

      expect(result.stepCreated).toBe(true);
      expect(result.step).toMatchObject({
        status: "running",
        attempt: 1,
        stepName: "lazy",
      });

      const log = await storage.events.list({ runId });
      expect(log.data.map((e) => e.eventType)).toEqual([
        "run_created",
        "run_started",
        "step_created",
        "step_started",
      ]);
      // The input rides the synthetic step_created, not the start.
      const started = log.data[3];
      expect((started.eventData as { input?: unknown }).input).toBeUndefined();
      expect((started.eventData as { stepName?: string }).stepName).toBe(
        "lazy",
      );
    });

    it("lets exactly one of many concurrent callers claim the step", async () => {
      const storage = createStorage();
      const runId = await startRun(storage);

      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          lazyStart(storage, runId, "step-race"),
        ),
      );
      const won = outcomes.filter((o) => o.status === "fulfilled");
      const lost = outcomes.filter((o) => o.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(9);
      for (const outcome of lost) {
        expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(
          EntityConflictError,
        );
      }

      const types = (await storage.events.list({ runId })).data.map(
        (e) => e.eventType,
      );
      expect(types.filter((t) => t === "step_created")).toHaveLength(1);
      expect(types.filter((t) => t === "step_started")).toHaveLength(1);
      expect(await slotsOf(storage, runId)).toEqual([1, 2, 3, 4]);
    });
  });

  describe("terminal runs", () => {
    async function runningStepOnCancelledRun(storage: Storage) {
      const runId = await startRun(storage);
      await storage.events.create(runId, {
        eventType: "step_created",
        correlationId: "step-1",
        eventData: { stepName: "s", input: [] },
      });
      await storage.events.create(runId, {
        eventType: "step_started",
        correlationId: "step-1",
      });
      await storage.events.create(runId, {
        eventType: "run_cancelled",
        eventData: {},
      });
      return runId;
    }

    it("refuses step_started even when the step still reads running", async () => {
      const storage = createStorage();
      const runId = await runningStepOnCancelledRun(storage);
      await expect(
        storage.events.create(runId, {
          eventType: "step_started",
          correlationId: "step-1",
        }),
      ).rejects.toBeInstanceOf(RunExpiredError);
    });

    it("still accepts the outcome of a step already in flight", async () => {
      const storage = createStorage();
      const runId = await runningStepOnCancelledRun(storage);
      const result = await storage.events.create(runId, {
        eventType: "step_completed",
        correlationId: "step-1",
        eventData: { result: new Uint8Array([1]) },
      });
      expect(result.step?.status).toBe("completed");
    });
  });

  describe("step outcome races", () => {
    it("records only one of two concurrent step_completed writes", async () => {
      const storage = createStorage();
      const runId = await startRun(storage);
      await storage.events.create(runId, {
        eventType: "step_created",
        correlationId: "step-1",
        eventData: { stepName: "s", input: [] },
      });
      await storage.events.create(runId, {
        eventType: "step_started",
        correlationId: "step-1",
      });

      const outcomes = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          storage.events.create(runId, {
            eventType: "step_completed",
            correlationId: "step-1",
            eventData: { result: new Uint8Array([1]) },
          }),
        ),
      );
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const completed = (await storage.events.list({ runId })).data.filter(
        (e) => e.eventType === "step_completed",
      );
      expect(completed).toHaveLength(1);
    });
  });

  describe("run status", () => {
    it("lets only one of two concurrent run_started writes append the event", async () => {
      const storage = createStorage();
      const created = await storage.events.create(null, {
        eventType: "run_created",
        eventData: { deploymentId: "d", workflowName: "w", input: [] },
      });
      const runId = created.run!.runId;

      await Promise.all(
        Array.from({ length: 8 }, () =>
          storage.events.create(runId, { eventType: "run_started" }),
        ),
      );
      const started = (await storage.events.list({ runId })).data.filter(
        (e) => e.eventType === "run_started",
      );
      expect(started).toHaveLength(1);
    });

    it("filters a listing by an array of statuses", async () => {
      const storage = createStorage();
      const pending = await storage.events.create(null, {
        eventType: "run_created",
        eventData: {
          deploymentId: "d",
          workflowName: "status-filter",
          input: [],
        },
      });
      const running = await storage.events.create(null, {
        eventType: "run_created",
        eventData: {
          deploymentId: "d",
          workflowName: "status-filter",
          input: [],
        },
      });
      await storage.events.create(running.run!.runId, {
        eventType: "run_started",
      });

      const both = await storage.runs.list({
        workflowName: "status-filter",
        status: ["pending", "running"],
      });
      expect(both.data.map((r) => r.runId).sort()).toEqual(
        [pending.run!.runId, running.run!.runId].sort(),
      );

      const onlyRunning = await storage.runs.list({
        workflowName: "status-filter",
        status: ["running"],
      });
      expect(onlyRunning.data.map((r) => r.runId)).toEqual([
        running.run!.runId,
      ]);

      // An empty list matches nothing, unlike omitting the filter.
      const none = await storage.runs.list({
        workflowName: "status-filter",
        status: [],
      });
      expect(none.data).toEqual([]);
    });
  });

  describe("listing", () => {
    async function runsInStates(storage: Storage, name: string) {
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const created = await storage.events.create(null, {
          eventType: "run_created",
          eventData: { deploymentId: "d", workflowName: name, input: [] },
        });
        ids.push(created.run!.runId);
        // Distinct transition times keep the order unambiguous.
        await new Promise((resolve) => setTimeout(resolve, 3));
      }
      for (const runId of ids.slice(0, 3)) {
        await storage.events.create(runId, { eventType: "run_started" });
        await new Promise((resolve) => setTimeout(resolve, 3));
      }
      return ids;
    }

    async function pageThrough(
      storage: Storage,
      params: Parameters<Storage["runs"]["list"]>[0],
      limit: number,
    ) {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await storage.runs.list({
          ...params,
          pagination: { ...params?.pagination, limit, cursor },
        });
        seen.push(...result.data.map((run) => run.runId));
        if (!result.hasMore) return seen;
        cursor = result.cursor ?? undefined;
      }
      throw new Error("paging did not end");
    }

    it("visits every run once when paging across several statuses", async () => {
      const storage = createStorage();
      const ids = await runsInStates(storage, "merged");
      const desc = await pageThrough(
        storage,
        { status: ["pending", "running"] },
        2,
      );
      expect([...desc].sort()).toEqual([...ids].sort());
      expect(new Set(desc).size).toBe(ids.length);

      // Ascending is the same set in the opposite order.
      const asc = await pageThrough(
        storage,
        { status: ["pending", "running"], pagination: { sortOrder: "asc" } },
        2,
      );
      expect(asc).toEqual([...desc].reverse());
    });

    it("lists hooks oldest first and runs newest first by default", async () => {
      const storage = createStorage();
      const runId = await startRun(storage);
      for (const name of ["a", "b", "c"]) {
        await storage.events.create(runId, {
          eventType: "hook_created",
          correlationId: `hook-${name}`,
          eventData: { token: `token-${name}-${randomUUID()}` },
        });
        await new Promise((resolve) => setTimeout(resolve, 3));
      }
      const hooks = await storage.hooks.list({ runId });
      expect(hooks.data.map((hook) => hook.hookId)).toEqual([
        "hook-a",
        "hook-b",
        "hook-c",
      ]);
      const newest = await storage.hooks.list({
        runId,
        pagination: { sortOrder: "desc" },
      });
      expect(newest.data.map((hook) => hook.hookId)).toEqual([
        "hook-c",
        "hook-b",
        "hook-a",
      ]);
    });
  });

  describe("attributes", () => {
    it("seeds attributes at creation and returns them on reads", async () => {
      const storage = createStorage();
      const created = await storage.events.create(null, {
        eventType: "run_created",
        eventData: {
          deploymentId: "d",
          workflowName: "w",
          input: [],
          attributes: { team: "core" },
        },
      });
      expect(created.run?.attributes).toEqual({ team: "core" });
      const read = await storage.runs.get(created.run!.runId);
      expect(read.attributes).toEqual({ team: "core" });
    });

    it("keeps concurrent changes to different keys", async () => {
      const storage = createStorage();
      const runId = await startRun(storage);
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          storage.events.create(runId, {
            eventType: "attr_set",
            eventData: {
              changes: [{ key: `k${i}`, value: `v${i}` }],
              writer: { type: "workflow" },
            },
          } as never),
        ),
      );
      const run = await storage.runs.get(runId);
      expect(Object.keys(run.attributes).sort()).toEqual(
        Array.from({ length: 10 }, (_, i) => `k${i}`).sort(),
      );
    });
  });

  describe("attr_set", () => {
    const set = (
      storage: Storage,
      runId: string,
      extra: Record<string, unknown> = {},
    ) =>
      storage.events.create(runId, {
        eventType: "attr_set",
        eventData: {
          changes: [{ key: "k", value: "v" }],
          writer: { type: "workflow" },
        },
        ...extra,
      } as never);

    it("is refused on a finished run", async () => {
      const storage = createStorage();
      const runId = await startRun(storage);
      await storage.events.create(runId, { eventType: "run_cancelled" });
      await expect(set(storage, runId)).rejects.toBeInstanceOf(
        EntityConflictError,
      );
    });

    it("is applied once per correlation id when a workflow replays it", async () => {
      const storage = createStorage();
      const runId = await startRun(storage);
      await set(storage, runId, { correlationId: "attr_1" });
      await expect(
        set(storage, runId, { correlationId: "attr_1" }),
      ).rejects.toBeInstanceOf(EntityConflictError);
    });
  });

  describe("lazy hook resume", () => {
    async function runWithHook(storage: Storage) {
      const runId = await startRun(storage);
      await storage.events.create(runId, {
        eventType: "hook_created",
        correlationId: "hook-1",
        eventData: { token: `token-${randomUUID()}` },
      });
      return runId;
    }

    it("converges two writers with one resumeId on a single event", async () => {
      const storage = createStorage();
      const runId = await runWithHook(storage);

      const writes = await Promise.all(
        Array.from({ length: 5 }, () =>
          storage.events.create(
            runId,
            {
              eventType: "hook_received",
              correlationId: "hook-1",
              eventData: { payload: new Uint8Array([9]) },
            },
            { resumeId: "resume-1", resumePayloadDigest: "digest-a" },
          ),
        ),
      );
      expect(new Set(writes.map((w) => w.event?.eventId)).size).toBe(1);
      const received = (await storage.events.list({ runId })).data.filter(
        (e) => e.eventType === "hook_received",
      );
      expect(received).toHaveLength(1);
    });

    it("refuses a reused resumeId that carries a different payload", async () => {
      const storage = createStorage();
      const runId = await runWithHook(storage);
      const write = (digest: string) =>
        storage.events.create(
          runId,
          {
            eventType: "hook_received",
            correlationId: "hook-1",
            eventData: { payload: new Uint8Array([9]) },
          },
          { resumeId: "resume-2", resumePayloadDigest: digest },
        );
      await write("digest-a");
      await expect(write("digest-b")).rejects.toBeInstanceOf(
        EntityConflictError,
      );
    });
  });
});
