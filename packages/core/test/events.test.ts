import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  brick,
  defineDatabase,
  defineListener,
  defineService,
  emitEvent,
  EventsHub,
  isOutboxTable,
  outboxTable,
  runInTransaction,
  syncSchema,
  type EventDelivery,
} from "../src";
import { backoffMs } from "../src/events/dispatcher";
import { matchesEvent } from "../src/events/hub";
import { newEventId } from "../src/events/id";
import { outboxEngine } from "../src/events/outbox";

const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
});
const outbox = outboxTable("sqlite");

let serial = 0;
const hubs: EventsHub[] = [];

function setup(
  listeners: Parameters<typeof defineListener>[0][],
  dispatch = {},
) {
  const database = defineDatabase({ tables: { items, outbox } });
  const db: any = database.getDb();
  syncSchema([items, outbox], db);
  const service = defineService(`events_test_${++serial}`, { database });
  const hub = new EventsHub({
    listeners: listeners.map(defineListener),
    dispatch: { timer: false, maxBackoffMs: 5, ...dispatch },
  }).attach([service]);
  hubs.push(hub);
  return { db, service, hub, events: service.events! };
}

const rows = (db: any) => db.select().from(outbox).all();

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.stop()));
});

describe("event helpers", () => {
  it("matches names exactly, by prefix, and with a wildcard", () => {
    expect(matchesEvent("user.create", "user.create")).toBe(true);
    expect(matchesEvent("user.create", "user.update")).toBe(false);
    expect(matchesEvent("user.*", "user.update")).toBe(true);
    expect(matchesEvent("user.*", "order.create")).toBe(false);
    expect(matchesEvent("*", "anything.at.all")).toBe(true);
  });

  it("makes event ids that are unique and sort by time", () => {
    const a = newEventId(1_000);
    const b = newEventId(2_000);
    expect(a).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 500 }, () => newEventId())).size).toBe(
      500,
    );
  });

  it("backs off from a second up to a cap", () => {
    expect(backoffMs(1, 300_000)).toBe(1_000);
    expect(backoffMs(2, 300_000)).toBe(2_000);
    expect(backoffMs(4, 300_000)).toBe(8_000);
    expect(backoffMs(20, 300_000)).toBe(300_000);
  });

  it("brands the outbox table and knows its engine", () => {
    expect(isOutboxTable(outbox)).toBe(true);
    expect(isOutboxTable(items)).toBe(false);
    expect(outboxEngine(outbox)).toBe("sqlite");
    expect(outboxEngine(outboxTable("postgres", { name: "events_out" }))).toBe(
      "postgres",
    );
  });
});

describe("defineListener", () => {
  const run = () => {};
  it("refuses a bad name, no event, and a bad attempt count", () => {
    expect(() => defineListener({ name: "", on: "a", run })).toThrow(
      "needs a name",
    );
    expect(() => defineListener({ name: "a:b", on: "a", run })).toThrow(
      "must not contain ':'",
    );
    expect(() => defineListener({ name: "a", on: [], run })).toThrow(
      "listens for nothing",
    );
    expect(() =>
      defineListener({ name: "a", on: "a", run, maxAttempts: 0 }),
    ).toThrow("maxAttempts");
  });

  it("accepts one name or a list", () => {
    expect(defineListener({ name: "a", on: "x", run }).on).toEqual(["x"]);
    expect(defineListener({ name: "a", on: ["x", "y.*"], run }).on).toEqual([
      "x",
      "y.*",
    ]);
  });
});

describe("EventsHub", () => {
  it("refuses duplicate listener names", () => {
    const listener = defineListener({ name: "same", on: "x", run: () => {} });
    expect(() => new EventsHub({ listeners: [listener, listener] })).toThrow(
      "Duplicate event listener 'same'",
    );
  });

  it("gives only a service whose database holds an outbox a recorder", () => {
    const withOutbox = setup([{ name: "a", on: "x", run: () => {} }]);
    expect(withOutbox.events).toBeDefined();
    const plain = defineService(`events_test_${++serial}`, {
      database: defineDatabase({ tables: { items } }),
    });
    const hub = new EventsHub({}).attach([plain]);
    hubs.push(hub);
    expect(plain.events).toBeUndefined();
  });

  it("warns when events are set but no database has an outbox", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const plain = defineService(`events_test_${++serial}`, {
      database: defineDatabase({ tables: { items } }),
    });
    hubs.push(
      new EventsHub({
        listeners: [defineListener({ name: "a", on: "x", run() {} })],
      }).attach([plain]),
    );
    expect(warn.mock.calls[0]?.[0]).toContain(
      "no service database has an outbox table",
    );
    warn.mockRestore();
  });

  it("describes itself as plain data that survives structured clone", () => {
    const { hub } = setup([{ name: "a", on: ["x", "y.*"], run: () => {} }]);
    const described = hub.describe();
    expect(() => structuredClone(described)).not.toThrow();
    expect(described).toEqual({
      listeners: [{ name: "a", on: ["x", "y.*"], kind: "handler" }],
      dispatch: true,
    });
  });
});

describe("recording events", () => {
  it("commits the events with the write, one row per listener", async () => {
    const { db, events } = setup([
      { name: "mail", on: "item.create", run: () => {} },
      { name: "audit", on: "item.*", run: () => {} },
      { name: "other", on: "order.create", run: () => {} },
    ]);
    await events.transaction(
      db,
      { traceId: "tr_1", source: "svc.item" },
      async (tx, record) => {
        await tx.insert(items).values({ label: "a" });
        await record("item.create", { id: 1, row: { label: "a" } });
      },
    );

    expect(db.select().from(items).all()).toHaveLength(1);
    const recorded = rows(db);
    expect(recorded.map((row: any) => row.listener).sort()).toEqual([
      "audit",
      "mail",
    ]);
    const [first] = recorded;
    expect(first).toMatchObject({
      name: "item.create",
      payload: { id: 1, row: { label: "a" } },
      traceId: "tr_1",
      source: "svc.item",
      status: "pending",
      attempts: 0,
    });
    expect(new Set(recorded.map((row: any) => row.eventId)).size).toBe(1);
    expect(recorded.map((row: any) => row.id).sort()).toEqual([
      `${first.eventId}:audit`,
      `${first.eventId}:mail`,
    ]);
  });

  it("records nothing, and undoes the write, when the transaction fails", async () => {
    const { db, events } = setup([
      { name: "mail", on: "item.create", run: () => {} },
    ]);
    await expect(
      events.transaction(db, {}, async (tx, record) => {
        await tx.insert(items).values({ label: "a" });
        await record("item.create", { id: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(db.select().from(items).all()).toHaveLength(0);
    expect(rows(db)).toHaveLength(0);
  });

  it("records nothing for an event nobody listens for", async () => {
    const { db, events } = setup([
      { name: "mail", on: "item.create", run: () => {} },
    ]);
    expect(events.wants("item.create")).toBe(true);
    expect(events.wants("item.delete")).toBe(false);
    await events.transaction(db, {}, async (_tx, record) => {
      await record("item.delete", { id: 1 });
    });
    expect(rows(db)).toHaveLength(0);
  });

  it("lets transactions on one SQLite database take turns", async () => {
    const { db, events } = setup([
      { name: "mail", on: "item.create", run: () => {} },
    ]);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        events.transaction(db, {}, async (tx, record) => {
          await tx.insert(items).values({ label: `item ${index}` });
          await new Promise((resolve) => setTimeout(resolve, 1));
          await record("item.create", { index });
        }),
      ),
    );
    expect(db.select().from(items).all()).toHaveLength(20);
    expect(rows(db)).toHaveLength(20);
  });
});

describe("delivering events", () => {
  async function record(
    setupResult: ReturnType<typeof setup>,
    name = "item.create",
    payload: unknown = { id: 1 },
  ) {
    await setupResult.events.transaction(
      setupResult.db,
      { traceId: "tr_9", source: "s.i" },
      async (_tx, rec) => {
        await rec(name, payload);
      },
    );
  }

  it("runs the listener with the delivery, then marks the row delivered", async () => {
    const seen: EventDelivery[] = [];
    const ctx = setup([
      { name: "mail", on: "item.create", run: (d) => void seen.push(d) },
    ]);
    await record(ctx);
    expect(await ctx.hub.drain()).toBe(1);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      name: "item.create",
      payload: { id: 1 },
      traceId: "tr_9",
      source: "s.i",
      listener: "mail",
      attempt: 1,
    });
    expect(seen[0].deliveryId).toBe(`${seen[0].id}:mail`);
    expect(Number.isNaN(Date.parse(seen[0].occurredAt))).toBe(false);
    expect(await ctx.hub.counts()).toEqual({
      pending: 0,
      claimed: 0,
      delivered: 1,
      dead: 0,
    });
  });

  it("delivers each listener of an event independently", async () => {
    const calls: string[] = [];
    const ctx = setup([
      { name: "good", on: "item.create", run: () => void calls.push("good") },
      {
        name: "bad",
        on: "item.create",
        run: () => {
          throw new Error("nope");
        },
        maxAttempts: 2,
      },
    ]);
    await record(ctx);
    await ctx.hub.drain();
    expect(calls).toEqual(["good"]);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await ctx.hub.drain();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await ctx.hub.drain();
    expect(calls).toEqual(["good"]);
    expect(await ctx.hub.counts()).toEqual({
      pending: 0,
      claimed: 0,
      delivered: 1,
      dead: 1,
    });
  });

  it("retries a failing listener later, with the attempt counted", async () => {
    const attempts: number[] = [];
    const ctx = setup([
      {
        name: "flaky",
        on: "item.create",
        run: (d) => {
          attempts.push(d.attempt);
          if (d.attempt < 3) throw new Error(`fail ${d.attempt}`);
        },
      },
    ]);
    await record(ctx);
    await ctx.hub.drain();
    expect(attempts).toEqual([1]);
    expect(await ctx.hub.counts()).toEqual({
      pending: 1,
      claimed: 0,
      delivered: 0,
      dead: 0,
    });
    expect(rows(ctx.db)[0].lastError).toBe("fail 1");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await ctx.hub.drain();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await ctx.hub.drain();
    expect(attempts).toEqual([1, 2, 3]);
    expect(await ctx.hub.counts()).toEqual({
      pending: 0,
      claimed: 0,
      delivered: 1,
      dead: 0,
    });
  });

  it("parks a delivery as dead when its attempts run out, and retries it on request", async () => {
    let fail = true;
    const ctx = setup(
      [
        {
          name: "stubborn",
          on: "item.create",
          maxAttempts: 2,
          run: () => {
            if (fail) throw new Error("still no");
          },
        },
      ],
      { maxBackoffMs: 1 },
    );
    await record(ctx);
    for (let round = 0; round < 3; round++) {
      await ctx.hub.drain();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await ctx.hub.counts()).toEqual({
      pending: 0,
      claimed: 0,
      delivered: 0,
      dead: 1,
    });
    expect(rows(ctx.db)[0]).toMatchObject({
      status: "dead",
      attempts: 2,
      lastError: "still no",
    });

    fail = false;
    expect(await ctx.hub.retryDead()).toBe(1);
    await ctx.hub.drain();
    expect(await ctx.hub.counts()).toEqual({
      pending: 0,
      claimed: 0,
      delivered: 1,
      dead: 0,
    });
    expect(rows(ctx.db)[0].attempts).toBe(1);
  });

  it("parks a delivery whose listener is no longer registered", async () => {
    const ctx = setup([{ name: "gone", on: "item.create", run: () => {} }]);
    await record(ctx);
    const other = new EventsHub({ listeners: [], dispatch: true }).attach([
      Object.assign(Object.create(null), {
        name: "x",
        getDb: () => ctx.db,
        getOutbox: () => outbox,
        setEvents: () => {},
      }),
    ]);
    hubs.push(other);
    await other.drain();
    expect(rows(ctx.db)[0]).toMatchObject({ status: "dead" });
    expect(rows(ctx.db)[0].lastError).toContain("No listener named 'gone'");
  });

  it("takes over a claim that was never finished", async () => {
    const calls: string[] = [];
    const ctx = setup(
      [{ name: "mail", on: "item.create", run: () => void calls.push("ran") }],
      {
        claimTimeoutMs: 20,
      },
    );
    await record(ctx);
    ctx.db.$client.run(
      `UPDATE brick_outbox SET status = 'claimed', claimed_at = ${Date.now() - 1000}`,
    );
    await ctx.hub.drain();
    expect(calls).toEqual(["ran"]);
    expect(await ctx.hub.counts()).toEqual({
      pending: 0,
      claimed: 0,
      delivered: 1,
      dead: 0,
    });
  });

  it("does not take a claim that is still fresh", async () => {
    const calls: string[] = [];
    const ctx = setup(
      [{ name: "mail", on: "item.create", run: () => void calls.push("ran") }],
      {
        claimTimeoutMs: 60_000,
      },
    );
    await record(ctx);
    ctx.db.$client.run(
      `UPDATE brick_outbox SET status = 'claimed', claimed_at = ${Date.now()}`,
    );
    await ctx.hub.drain();
    expect(calls).toEqual([]);
  });

  it("keeps no delivered rows when retention is zero", async () => {
    const ctx = setup([{ name: "mail", on: "item.create", run: () => {} }], {
      retainDeliveredMs: 0,
    });
    await record(ctx);
    await ctx.hub.drain();
    expect(rows(ctx.db)).toHaveLength(0);
  });

  it("delivers on its own after a commit once started", async () => {
    const seen: string[] = [];
    const ctx = setup(
      [{ name: "mail", on: "item.create", run: (d) => void seen.push(d.name) }],
      {
        timer: true,
        intervalMs: 5_000,
      },
    );
    ctx.hub.start();
    await record(ctx);
    for (let wait = 0; wait < 100 && seen.length === 0; wait++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual(["item.create"]);
  });

  it("only records when this process does not dispatch", async () => {
    const seen: string[] = [];
    const ctx = setup([
      { name: "mail", on: "item.create", run: () => void seen.push("x") },
    ]);
    const recordOnly = new EventsHub({
      listeners: [
        defineListener({ name: "mail", on: "item.create", run: () => {} }),
      ],
      dispatch: false,
    }).attach([ctx.service]);
    hubs.push(recordOnly);
    recordOnly.start();
    await ctx.service.events!.transaction(ctx.db, {}, async (_tx, rec) => {
      await rec("item.create", {});
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(rows(ctx.db)[0].status).toBe("pending");
    expect(seen).toEqual([]);
  });
});

describe("brick({ events })", () => {
  it("puts the hub on the app and its description in the definition", () => {
    const database = defineDatabase({ tables: { items, outbox } });
    const service = defineService(`events_test_${++serial}`, { database });
    const app = brick({
      services: [service],
      events: {
        listeners: [defineListener({ name: "a", on: "x.*", run: () => {} })],
      },
      requestLogging: false,
      docs: false,
    });
    hubs.push(app.events!);
    expect(app.events).toBeInstanceOf(EventsHub);
    expect(service.events).toBeDefined();
    expect(app.definition.events).toEqual({
      listeners: [{ name: "a", on: ["x.*"], kind: "handler" }],
      dispatch: true,
    });
  });

  it("changes nothing when events are not set", () => {
    const service = defineService(`events_test_${++serial}`, {
      database: defineDatabase({ tables: { items, outbox } }),
    });
    const app = brick({
      services: [service],
      requestLogging: false,
      docs: false,
    });
    expect(app.events).toBeUndefined();
    expect(app.definition.events).toBeUndefined();
    expect(service.events).toBeUndefined();
  });
});

describe("row lookups the tests rely on", () => {
  it("find a delivery by its id", async () => {
    const ctx = setup([{ name: "mail", on: "item.create", run: () => {} }]);
    await ctx.events.transaction(ctx.db, {}, async (_tx, rec) => {
      await rec("item.create", {});
    });
    const [row] = rows(ctx.db);
    expect(
      ctx.db.select().from(outbox).where(eq(outbox.id, row.id)).all(),
    ).toHaveLength(1);
  });
});

describe("emitEvent", () => {
  function emitting(listener: (delivery: EventDelivery) => void) {
    const made = setup([{ name: "heard", on: "item.refunded", run: listener }]);
    const action = made.service.action({
      name: "refund",
      execute: async ({ ctx }: any) => {
        await emitEvent(ctx, "item.refunded", { id: 7 }, { source: "tests" });
        return "ok";
      },
    });
    return { ...made, action };
  }

  it("records an event of your own, delivered with the payload and the trace", async () => {
    const heard: EventDelivery[] = [];
    const { action, hub, db } = emitting(
      (delivery) => void heard.push(delivery),
    );

    await action.run({}, { traceId: "tr_custom" });
    expect(rows(db)).toHaveLength(1);
    await hub.drain();

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      name: "item.refunded",
      payload: { id: 7 },
      traceId: "tr_custom",
      source: "tests",
      listener: "heard",
    });
  });

  it("records nothing when no listener wants the event", async () => {
    const { service, db } = setup([
      { name: "other", on: "x.y", run: () => {} },
    ]);
    const action = service.action({
      name: "quiet",
      execute: async ({ ctx }: any) => emitEvent(ctx, "item.refunded", {}),
    });
    await action.run({});
    expect(rows(db)).toHaveLength(0);
  });

  it("commits with a transaction you hold, or not at all", async () => {
    const { service, hub, db } = setup([
      { name: "heard", on: "item.refunded", run: () => {} },
    ]);
    const ctx = { db: service.getDb(), traceId: "tr_tx" };

    await expect(
      runInTransaction(db, async (tx) => {
        await tx.insert(items).values({ label: "gone" });
        await emitEvent(ctx, "item.refunded", { id: 1 }, { tx });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(rows(db)).toHaveLength(0);
    expect(db.select().from(items).all()).toHaveLength(0);

    await runInTransaction(db, async (tx) => {
      await tx.insert(items).values({ label: "kept" });
      await emitEvent(ctx, "item.refunded", { id: 2 }, { tx });
    });
    expect(rows(db)).toHaveLength(1);
    expect(await hub.drain()).toBe(1);
  });

  it("explains a context whose database has no outbox", async () => {
    const plain = defineDatabase({ tables: { items } });
    await expect(
      emitEvent({ db: plain.getDb() }, "item.refunded", {}),
    ).rejects.toThrow("outbox table");
    await expect(emitEvent({}, "item.refunded", {})).rejects.toThrow(
      "Cannot emit",
    );
  });
});
