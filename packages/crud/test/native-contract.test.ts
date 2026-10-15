import { expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Brick } from "@brickkit/core";
import { HttpApi, HttpApiGroup } from "effect/http-api";
import { createClient } from "@brickkit/client";
import { crudContract, sqliteStore } from "../src/native";
import { sqliteDatabase } from "../src/sqlite";

interface Db {
  readonly Db: unique symbol;
}
const Database = sqliteDatabase<Db>()("native-contract/Db", {
  filename: ":memory:",
});
const table = sqliteTable("native_contract", {
  id: integer().primaryKey(),
  title: text().notNull().unique(),
  secret: text().default("hidden"),
});
class Rejected extends Schema.TaggedError<Rejected>()(
  "Rejected",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}
const resource = crudContract({
  name: "pages",
  path: "/pages",
  table,
  id: "id",
  fields: {
    id: { read: true },
    title: { read: true, create: true, update: true, filter: ["eq"] },
    secret: {},
  },
  errors: [Rejected],
  operations: { delete: false },
  mcp: true,
});
const actions = resource.implement({
  store: sqliteStore(table, Database.Service),
  access: "public",
  hooks: {
    afterCreate: ({ row }) =>
      row.title === "reject"
        ? Effect.fail(new Rejected({ message: "Rejected title" }))
        : Effect.void,
  },
});
const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database.Service;
    yield* db.$client`CREATE TABLE native_contract (id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE, secret TEXT DEFAULT 'hidden')`;
  }),
).pipe(Layer.provideMerge(Database.layer));
const api = HttpApi.make("brick").add(
  HttpApiGroup.make("pages").add(
    resource.actions["pages.list"].endpoint,
    resource.actions["pages.create"].endpoint,
    resource.actions["pages.get"].endpoint,
    resource.actions["pages.update"].endpoint,
    resource.actions["pages.count"].endpoint,
  ),
);
// @ts-expect-error Disabled operations are absent from the typed action record.
void actions["pages.delete"];
// @ts-expect-error Hidden fields cannot be written.
actions["pages.create"].handler({ payload: { title: "x", secret: "leak" } });
// @ts-expect-error Missing database requirement cannot disappear.
const closed: Effect.Effect<unknown, unknown, never> = actions[
  "pages.list"
].handler({ payload: {} });
void closed;

test("generated CRUD shares native contracts, errors and transaction ownership", async () => {
  const app = Brick.app({
    services: [Brick.service("pages", { actions })],
    layer: setup,
  });
  const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) });
  const remote = await createClient(api, { baseUrl: server.url.toString() });
  try {
    expect("pages.delete" in actions).toBe(false);
    expect(actions["pages.create"].endpoint).toBe(
      resource.actions["pages.create"].endpoint,
    );
    expect(actions["pages.create"].mcp).toBe(true);
    expect(
      await remote.client.pages["pages.create"]({
        payload: { title: "hello" },
      }),
    ).toEqual({ id: 1, title: "hello" });
    expect(
      await remote.client.pages["pages.list"]({
        payload: { includeTotal: true },
      }),
    ).toEqual({
      items: [{ id: 1, title: "hello" }],
      total: 1,
      limit: 50,
      offset: 0,
    });
    await expect(
      remote.client.pages["pages.create"]({ payload: { title: "reject" } }),
    ).rejects.toBeInstanceOf(Rejected);
    const rejected = await app.fetch(
      new Request("http://localhost/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"title":"reject"}',
      }),
    );
    expect(rejected.status).toBe(422);
    expect(await remote.client.pages["pages.count"]({ payload: {} })).toEqual({
      count: 1,
    });
    // Legacy flat calls normalize into request parts.
    expect(
      await remote.client.pages["pages.create"]({ title: "flat" }),
    ).toEqual({ id: 2, title: "flat" });
    expect(await remote.client.pages["pages.get"]({ id: 2 })).toEqual({
      id: 2,
      title: "flat",
    });
    expect(
      await remote.client.pages["pages.update"]({ id: 2, title: "renamed" }),
    ).toEqual({ id: 2, title: "renamed" });
    const missing = await app.fetch(
      new Request("http://localhost/pages/999", {
        method: "GET",
      }),
    );
    expect(missing.status).toBe(404);
  } finally {
    await remote.dispose();
    await server.stop(true);
    await app.dispose();
  }
});
