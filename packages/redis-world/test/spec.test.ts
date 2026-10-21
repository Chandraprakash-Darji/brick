import { RedisContainer } from "@testcontainers/redis";
import { createTestSuite } from "@workflow/world-testing";
// Opt-in suite: `createTestSuite` does not include it in 4.1.20, so it has to
// be deep-imported. It asserts the world honours WORKFLOW_MAX_EVENTS via
// EventResult.maxEvents.
import { eventLimit } from "@workflow/world-testing/dist/src/event-limit.mjs";
import { afterAll, beforeAll, test } from "vitest";

// Skip these tests on Windows since it relies on a docker container
if (process.platform === "win32") {
  test.skip("skipped on Windows since it relies on a docker container", () => {});
} else {
  let container: Awaited<ReturnType<RedisContainer["start"]>>;

  beforeAll(async () => {
    // REDIS_TEST_URL points the suite at an existing Redis instead of a container.
    const redisUrl =
      process.env.REDIS_TEST_URL ??
      (container = await new RedisContainer(
        "redis:7-alpine",
      ).start()).getConnectionUrl();
    process.env.WORKFLOW_REDIS_URL = redisUrl;
    process.env.REDIS_URL = redisUrl;
  }, 120_000);

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  test("smoke", () => {});
  createTestSuite("@brickkit/redis-world");
  eventLimit("@brickkit/redis-world");
}
