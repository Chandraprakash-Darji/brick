import { strict as assert } from "node:assert";
import { test } from "bun:test";
import { Context, Effect, Layer, Schema } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as Drizzle from "drizzle-orm/effect-sqlite-bun";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const pages = sqliteTable("pages", {
  id: integer().primaryKey(),
  title: text().notNull(),
});

class Aborted extends Schema.TaggedError<Aborted>()("Aborted", {}) {}
class Database extends Context.Service<
  Database,
  Effect.Success<ReturnType<typeof Drizzle.makeWithDefaults>>
>()("spike/Database") {
  static layer = Layer.effect(Database, Drizzle.makeWithDefaults()).pipe(
    Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
  );
}

test("SQLite Effect queries commit and roll back typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* db.$client`CREATE TABLE pages (id INTEGER PRIMARY KEY, title TEXT NOT NULL)`;
      yield* db.insert(pages).values({ id: 1, title: "first" });
      const result = yield* db.select().from(pages);
      assert.deepEqual(result, [{ id: 1, title: "first" }]);
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(pages).values({ id: 2, title: "rolled back" });
            return yield* new Aborted();
          }),
        )
        .pipe(Effect.catchTag("Aborted", () => Effect.void));
      assert.deepEqual(yield* db.select().from(pages), result);
      yield* db.transaction((tx) =>
        tx.insert(pages).values({ id: 3, title: "committed" }),
      );
      assert.equal((yield* db.select().from(pages)).length, 2);
    }).pipe(Effect.provide(Database.layer)),
  ));
