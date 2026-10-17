import { RedisContainer } from "@testcontainers/redis";
import { beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { getQueueTopicPrefix, type QueuePrefix } from "@workflow/world";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createWorld } from "../src/index.js";

// Review repro: the default retry budget retires a message long before the
// runtime's own delivery ceiling (MAX_QUEUE_DELIVERIES = 48; core records
// MAX_DELIVERIES_EXCEEDED on delivery 49). A retired message strands its run in
// `running` with no terminal event; nothing re-enqueues it until a process calls
// start() again.

let url: string;
let testContainer: Awaited<ReturnType<RedisContainer["start"]>> | undefined;
beforeAll(async () => {
  url =
    process.env.REDIS_TEST_URL ??
    (testContainer = await new RedisContainer(
      "redis:7-alpine",
    ).start()).getConnectionUrl();
}, 120_000);
afterAll(async () => {
  await testContainer?.stop();
});
const prefix: QueuePrefix = getQueueTopicPrefix("workflow");
const worlds: ReturnType<typeof createWorld>[] = [];

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((w) => w.close?.()));
});

describe("review: queue retry budget", () => {
  test("keeps redelivering a failing message until core can fail the run (delivery 49)", async () => {
    const id = randomUUID();
    const world = createWorld({
      redis: url,
      keyPrefix: `review:${id}:`,

      // Only the backoff is shortened; maxAttempts keep their defaults.
      backoffType: "fixed",
      backoffDelayMs: 5,
    });
    worlds.push(world);
    let deliveries = 0;
    world.registerHandler?.(prefix, async () => {
      deliveries++;
      // A transient failure: the app server is restarting, storage blipped, ...
      return Response.json({ error: "transient" }, { status: 500 });
    });
    await world.start();
    await world.queue(`${prefix}review-wf` as const, { runId: `wrun_${id}` });

    await vi.waitFor(
      async () => {
        const stats = await world.getQueueStats();
        expect(deliveries >= 49 || stats.failed > 0).toBe(true);
      },
      { timeout: 15_000, interval: 50 },
    );
    const stats = await world.getQueueStats();
    expect(deliveries).toBeGreaterThanOrEqual(49);
    expect(stats.failed).toBe(0);
  }, 30_000);
});
