import { randomUUID } from "node:crypto";
import { RedisContainer } from "@testcontainers/redis";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createWorld } from "../src/index.js";

// Retention end to end: finished runs past their policy are deleted with every
// key they own; live runs and runs inside the policy are not touched.
describe("run retention (Redis integration)", () => {
  if (process.platform === "win32") {
    test.skip("skipped on Windows since it relies on a docker container", () => {});
    return;
  }

  let container: Awaited<ReturnType<RedisContainer["start"]>> | undefined;
  let redisUrl: string;
  const worlds: ReturnType<typeof createWorld>[] = [];
  const clients: Redis[] = [];

  beforeAll(async () => {
    redisUrl =
      process.env.REDIS_TEST_URL ??
      (container = await new RedisContainer(
        "redis:7-alpine",
      ).start()).getConnectionUrl();
  }, 120_000);

  afterEach(async () => {
    await Promise.all(worlds.splice(0).map((world) => world.close?.()));
    await Promise.all(clients.splice(0).map((client) => client.quit()));
  });

  afterAll(async () => {
    await container?.stop();
  });

  function setup(
    retention: NonNullable<
      NonNullable<Parameters<typeof createWorld>[0]>["retention"]
    >,
  ) {
    const keyPrefix = `world:${randomUUID()}:`;
    const world = createWorld({
      redis: redisUrl,
      keyPrefix,
      jobPrefix: `w_${randomUUID()}_`,
      retention,
    });
    worlds.push(world);
    const redis = new Redis(redisUrl);
    clients.push(redis);
    return { world, redis, keyPrefix };
  }

  async function startRun(world: ReturnType<typeof createWorld>) {
    const created = await world.events.create(null, {
      eventType: "run_created",
      eventData: { deploymentId: "d", workflowName: "w", input: [] },
    });
    const runId = created.run!.runId;
    await world.events.create(runId, { eventType: "run_started" });
    await world.events.create(runId, {
      eventType: "step_created",
      correlationId: "step_1",
      eventData: { stepName: "s", input: [] },
    });
    return runId;
  }

  async function keysOf(redis: Redis, keyPrefix: string) {
    return (await redis.keys(`${keyPrefix}*`)).filter(
      (k) => !k.includes("reaper:lock"),
    );
  }

  test("deletes an expired run with everything it owns, and leaves a live run", async () => {
    const { world, redis, keyPrefix } = setup({ completed: { age: 0 } });
    const done = await startRun(world);
    await world.events.create(done, {
      eventType: "step_started",
      correlationId: "step_1",
    });
    await world.events.create(done, {
      eventType: "step_completed",
      correlationId: "step_1",
      eventData: { result: [] },
    });
    await world.events.create(done, {
      eventType: "run_completed",
      eventData: { output: [] },
    });
    const live = await startRun(world);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await world.sweepRetention()).toBe(1);

    await expect(world.runs.get(done)).rejects.toMatchObject({
      name: "WorkflowRunNotFoundError",
    });
    expect((await world.runs.get(live)).status).toBe("running");
    const left = await keysOf(redis, keyPrefix);
    expect(left.filter((k) => k.includes(done))).toEqual([]);
    expect((await world.runs.list({})).data.map((r) => r.runId)).toEqual([
      live,
    ]);
  });

  test("count keeps the newest finished runs", async () => {
    const { world } = setup({ completed: { count: 2 } });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await startRun(world);
      await world.events.create(id, {
        eventType: "run_completed",
        eventData: { output: [] },
      });
      ids.push(id);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await world.sweepRetention()).toBe(2);
    const left = (await world.runs.list({})).data.map((r) => r.runId).sort();
    expect(left).toEqual(ids.slice(2).sort());
  });

  test("a status without a policy is kept", async () => {
    const { world } = setup({ completed: { age: 0 } });
    const id = await startRun(world);
    await world.events.create(id, {
      eventType: "run_failed",
      eventData: { error: { message: "x" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await world.sweepRetention()).toBe(0);
    expect((await world.runs.get(id)).status).toBe("failed");
  });

  test("rejects an invalid policy", () => {
    expect(() =>
      createWorld({ redis: redisUrl, retention: { completed: { age: -1 } } }),
    ).toThrow(/retention.completed.age/);
  });
});
