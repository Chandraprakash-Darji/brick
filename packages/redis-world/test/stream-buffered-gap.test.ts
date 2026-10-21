import { RedisContainer } from "@testcontainers/redis";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStreamer } from "../src/streamer.js";

// Review2 repro: the gap check (prevId) is applied to live notifications only
// AFTER the initial read. A notification that is buffered while the initial
// XRANGE is in flight is enqueued without the check, so a chunk whose own
// notification was lost in that window (a subscriber reconnect: the resync
// catch-up is a no-op while `buffer` is set) is skipped for good: lastEntryId
// moves past it and every later catch-up reads from after it.

let url: string;
let testContainer: Awaited<ReturnType<RedisContainer["start"]>> | undefined;
beforeAll(async () => {
  url =
    process.env.REDIS_TEST_URL ??
    (testContainer = await new RedisContainer(
      "redis:7-alpine",
    ).start()).getConnectionUrl();

  writer = new Redis(url);
  admin = new Redis(url);
}, 120_000);
let writer: Redis;
let admin: Redis;

afterAll(async () => {
  await Promise.all([writer.quit(), admin.quit()]);
});

function gate() {
  let release!: () => void;
  const p = new Promise<void>((r) => {
    release = r;
  });
  return { p, release };
}

describe("review2: streamer initial read vs a lost notification", () => {
  it("delivers a chunk whose notification was lost while the history read was in flight", async () => {
    const keyPrefix = `review2:${randomUUID()}:`;
    const readerRedis = new Redis(url);
    const reading = createStreamer({ redis: readerRedis, keyPrefix });
    const writing = createStreamer({ redis: writer, keyPrefix });
    const runId = `wrun_${randomUUID()}`;
    const key = `${keyPrefix}stream:${runId}:out`;

    await writing.streams.write(runId, "out", "one");
    // Let the reader's subscriber attach.
    await new Promise((r) => setTimeout(r, 100));

    // Hold the reader's history XRANGE reply (taken now: ['one']) until we say so.
    const reached = gate();
    const hold = gate();
    const orig = readerRedis.xrange.bind(readerRedis);
    let armed = true;
    (readerRedis as any).xrange = async (...args: unknown[]) => {
      const value = await (orig as any)(...args);
      if (armed) {
        armed = false;
        reached.release();
        await hold.p;
      }
      return value;
    };

    const streamP = reading.streams.get(runId, "out");
    await reached.p;

    // 'two' reaches the stream, its notification is lost.
    await admin.xadd(
      key,
      "*",
      "data",
      Buffer.from("two").toString("base64"),
      "eof",
      "false",
    );
    // 'three' is published normally (prevId = 'two') and lands in the reader's buffer.
    await writing.streams.write(runId, "out", "three");
    await new Promise((r) => setTimeout(r, 100));
    hold.release();

    const stream = await streamP;
    const received: string[] = [];
    const pump = (async () => {
      const r = stream.getReader();
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        received.push(Buffer.from(value).toString());
      }
    })();
    await writing.streams.close(runId, "out");
    // Longer than one CATCH_UP_INTERVAL_MS, so the timer had its chance too.
    await Promise.race([pump, new Promise((r) => setTimeout(r, 3000))]);
    await stream.cancel().catch(() => {});
    await Promise.all([reading.close(), writing.close()]);
    await readerRedis.quit();

    expect(received).toEqual(["one", "two", "three"]); // actual: ['one', 'three']
  });
});

afterAll(async () => {
  await testContainer?.stop();
});
