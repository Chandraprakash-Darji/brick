import { expect, test } from "bun:test";
import { Effect, Layer, Redacted } from "effect";
import { bigint, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { Brick } from "@brickkit/core";
import { createClient } from "@brickkit/client";
import { crudContract, postgresStore } from "../src/native";
import { postgresDatabase } from "../src/postgres";
const url = process.env.BRICK_SPIKE_DATABASE_URL;
interface Db {
  readonly Db: unique symbol;
}
const Database = postgresDatabase<Db>()("native-codecs/Db", {
  url: Redacted.make(url ?? ""),
});
const records = pgTable("brick_native_codecs_20261015", {
  id: serial().primaryKey(),
  at: timestamp({ withTimezone: true }).notNull(),
  amount: bigint({ mode: "bigint" }).notNull(),
});
const resource = crudContract({
  name: "records",
  path: "/records",
  table: records,
  id: "id",
  fields: {
    id: { read: true },
    at: { read: true, create: true, filter: ["gte"] },
    amount: { read: true, create: true, filter: ["eq"] },
  },
  errors: [],
});
test.skipIf(!url)(
  "native CRUD codecs roundtrip dates, bigint and typed recursive filters over PostgreSQL and HTTP",
  async () => {
    const setup = Layer.effectDiscard(
      Effect.gen(function* () {
        const db = yield* Database.Service;
        yield* Effect.acquireRelease(
          db.$client`CREATE TABLE brick_native_codecs_20261015 (id serial PRIMARY KEY, at timestamptz NOT NULL, amount bigint NOT NULL)`,
          () =>
            db.$client`DROP TABLE brick_native_codecs_20261015`.pipe(
              Effect.orDie,
            ),
        );
      }),
    ).pipe(Layer.provideMerge(Database.layer));
    const actions = resource.implement({
      store: postgresStore(records, Database.Service),
      access: "public",
    });
    const app = Brick.app({
      services: [Brick.service("records", { actions })],
      layer: setup,
    });
    const server = Bun.serve({
      port: 0,
      fetch: (request) => app.fetch(request),
    });
    const client = await createClient(app.api, { baseUrl: server.url });
    try {
      const at = new Date("2026-10-15T00:00:00.000Z");
      const amount = 9007199254740993n;
      expect(
        await client.client.records["records.create"]({
          payload: { at, amount },
        }),
      ).toEqual({ id: 1, at, amount });
      expect(
        (
          await client.client.records["records.list"]({
            payload: {
              where: {
                and: [
                  { field: "at", op: "gte", value: at },
                  { field: "amount", op: "eq", value: amount },
                ],
              },
            },
          })
        ).items,
      ).toEqual([{ id: 1, at, amount }]);
      const raw = await app.fetch(
        new Request("http://localhost/records/1", {
          method: "GET",
        }),
      );
      expect(await raw.json()).toEqual({
        id: 1,
        at: at.toISOString(),
        amount: amount.toString(),
      });
      expect(JSON.stringify(app.openApi())).toContain('"amount"');
    } finally {
      await client.dispose();
      await server.stop(true);
      await app.dispose();
    }
  },
);
