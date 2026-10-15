import { test, expect } from "bun:test";
import { Effect, Context, Redacted, Schema } from "effect";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { postgresDatabase } from "../src/native/postgres";
import { postgresStore } from "../src/native/store";
import { crud } from "../src/native/crud";
const url = process.env.BRICK_SPIKE_DATABASE_URL;
interface PgDb {
  readonly PgDb: unique symbol;
}
const db = postgresDatabase<PgDb>()("crud-prototype/PgDb", {
  url: Redacted.make(url ?? "postgresql://brick@127.0.0.1:55441/postgres"),
});
const table = pgTable("brick_native_crud_prototype_20261015", {
  id: serial().primaryKey(),
  owner: text().notNull(),
  title: text().notNull().unique(),
});
class User extends Context.Service<User, { id: string }>()("pg-test/User") {}
class Aborted extends Schema.TaggedError<Aborted>()("Aborted", {}) {}
const api = crud({
  table,
  id: "id",
  store: postgresStore(table, db.Service),
  fields: {
    id: { read: true },
    title: {
      read: true,
      create: true,
      update: true,
      sort: true,
      filter: ["eq", "contains"],
    },
    owner: {},
  },
  access: {
    authorize: () => Effect.succeed(true),
    scope: ({ operation }) =>
      Effect.gen(function* () {
        const user = yield* User;
        return operation === "create" ? undefined : eq(table.owner, user.id);
      }),
  },
  hooks: {
    beforeCreate: ({ data }) =>
      Effect.gen(function* () {
        const user = yield* User;
        return { ...data, owner: user.id };
      }),
    afterCreate: ({ row }) =>
      row.title === "abort" ? Effect.fail(new Aborted()) : Effect.void,
  },
});
test.skipIf(!url)(
  "PostgreSQL CRUD shares policy pipeline, scopes and rollback",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* db.Service;
        yield* database.$client`CREATE TABLE brick_native_crud_prototype_20261015 (id serial PRIMARY KEY, owner text NOT NULL, title text NOT NULL UNIQUE)`;
        yield* Effect.gen(function* () {
          const first = yield* api.create.decode({ title: "first" });
          expect(first.title).toBe("first");
          yield* api.create
            .decode({ title: "private" })
            .pipe(Effect.provideService(User, { id: "bob" }));
          expect(
            (yield* api.list.decode({ includeTotal: true })).items,
          ).toHaveLength(1);
          expect(yield* api.count.decode({})).toEqual({ count: 1 });
          expect(yield* api.exists.decode({})).toEqual({ exists: true });
          expect(
            (yield* api.findOne.decode({
              where: { field: "title", op: "contains", value: "irs" },
            }))?.title,
          ).toBe("first");
          expect(
            yield* api.create.decode({ title: "first" }).pipe(Effect.flip),
          ).toMatchObject({ _tag: "Conflict" });
          expect(
            yield* api.create.decode({ title: "abort" }).pipe(Effect.flip),
          ).toMatchObject({ _tag: "Aborted" });
          expect(yield* api.count.decode({})).toEqual({ count: 1 });
          if (first.id === undefined)
            return yield* Effect.die("Missing generated id");
          expect(
            (yield* api.update.decode({
              id: first.id,
              data: { title: "updated" },
            })).title,
          ).toBe("updated");
          expect((yield* api.get.decode({ id: first.id })).title).toBe(
            "updated",
          );
          expect(yield* api.delete.decode({ id: first.id })).toEqual({
            success: true,
          });
          expect(
            yield* api.get.decode({ id: first.id }).pipe(Effect.flip),
          ).toMatchObject({ _tag: "NotFound" });
        }).pipe(
          Effect.ensuring(
            database.$client`DROP TABLE brick_native_crud_prototype_20261015`.pipe(
              Effect.orDie,
            ),
          ),
        );
      }).pipe(
        Effect.provideService(User, { id: "alice" }),
        Effect.provide(db.layer),
      ),
    ),
);
