import { sqliteStore } from "../src/native/store";
import { test, expect } from "bun:test";
import { Context, Effect, Schema } from "effect";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { sqliteDatabase } from "../src/native/sqlite";
import { crud, type Authorization, type Inputs } from "../src/native/crud";
const pages = sqliteTable("pages", {
  id: integer().primaryKey(),
  owner: text().notNull(),
  title: text().notNull().unique(),
  secret: text().notNull().default("hidden"),
});
interface AppDb {
  readonly AppDb: unique symbol;
}
const Database = sqliteDatabase<AppDb>()("test/database", {
  filename: ":memory:",
});
class User extends Context.Service<User, { readonly id: string }>()(
  "test/User",
) {}
class HookFailure extends Schema.TaggedError<HookFailure>()(
  "HookFailure",
  {},
) {}
const fields = {
  id: { read: true, filter: ["eq"] },
  owner: { filter: ["eq"] },
  title: {
    read: true,
    create: true,
    update: true,
    filter: ["eq", "contains"],
    sort: true,
  },
  secret: {},
} as const;
const resource = () =>
  crud({
    table: pages,
    id: "id",
    store: sqliteStore(pages, Database.Service),
    fields,
    maxLimit: 10,
    defaultLimit: 5,
    access: {
      authorize: () => Effect.succeed(true),
      scope: ({ operation }) =>
        Effect.gen(function* () {
          const user = yield* User;
          return operation === "create" ? undefined : eq(pages.owner, user.id);
        }),
    },
    hooks: {
      beforeCreate: ({ data }) =>
        Effect.gen(function* () {
          const user = yield* User;
          return { ...data, owner: user.id };
        }),
      afterCreate: ({ row }) =>
        row.title === "rollback" ? Effect.fail(new HookFailure()) : Effect.void,
    },
  });
const setup = Effect.gen(function* () {
  const db = yield* Database.Service;
  yield* db.$client`CREATE TABLE pages (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL UNIQUE, secret TEXT NOT NULL DEFAULT 'hidden')`;
});
const run = <A, E>(program: Effect.Effect<A, E, AppDb | User>) =>
  Effect.runPromise(
    program.pipe(
      Effect.provideService(User, { id: "alice" }),
      Effect.provide(Database.layer),
    ),
  );
test("permissions, scopes and all CRUD operations use real SQLite", () =>
  run(
    Effect.gen(function* () {
      yield* setup;
      const api = resource();
      expect(yield* api.create.decode({ title: "hello" })).toEqual({
        id: 1,
        title: "hello",
      });
      expect(
        yield* api.create
          .decode({ title: "private" })
          .pipe(Effect.provideService(User, { id: "bob" })),
      ).toEqual({ id: 2, title: "private" });
      expect(yield* api.list.decode({ includeTotal: true })).toEqual({
        items: [{ id: 1, title: "hello" }],
        total: 1,
        limit: 5,
        offset: 0,
      });
      expect(yield* api.count.decode({})).toEqual({ count: 1 });
      expect(yield* api.exists.decode({})).toEqual({ exists: true });
      expect(
        yield* api.findOne.decode({
          where: { field: "title", op: "contains", value: "ell" },
        }),
      ).toEqual({ id: 1, title: "hello" });
      expect(yield* api.get.decode({ id: 2 }).pipe(Effect.flip)).toMatchObject({
        _tag: "NotFound",
      });
      expect(
        yield* api.update.decode({ id: 1, data: { title: "changed" } }),
      ).toEqual({ id: 1, title: "changed" });
      expect(yield* api.delete.decode({ id: 1 })).toEqual({ success: true });
      expect(yield* api.exists.decode({})).toEqual({ exists: false });
    }),
  ));
test("invalid writes, forbidden filters, limits and identifiers are rejected", () =>
  run(
    Effect.gen(function* () {
      yield* setup;
      const api = resource();
      for (const effect of [
        api.create.decode({ title: "x", owner: "mallory" }),
        api.list.decode({
          where: { field: "secret", op: "eq", value: "hidden" },
        }),
        api.list.decode({ limit: 0 }),
        api.list.decode({ limit: 11 }),
        api.update.decode({ id: 1, data: { id: 2 } }),
        api.list.decode({ select: ["secret"] }),
        api.list.decode({ where: { field: "title", op: "eq", value: 123 } }),
      ].map((effect: Effect.Effect<unknown, unknown, AppDb | User>) =>
        Effect.asVoid(effect),
      ))
        expect(yield* effect.pipe(Effect.flip)).toMatchObject({
          _tag: "InvalidInput",
        });
    }),
  ));
test("hook failure rolls back transaction and preserves typed error", () =>
  run(
    Effect.gen(function* () {
      yield* setup;
      const api = resource();
      expect(
        yield* api.create.decode({ title: "rollback" }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "HookFailure" });
      expect(yield* api.count.decode({})).toEqual({ count: 0 });
    }),
  ));
test("duplicate unique value is Conflict", () =>
  run(
    Effect.gen(function* () {
      yield* setup;
      const api = resource();
      yield* api.create.decode({ title: "x" });
      expect(
        yield* api.create.decode({ title: "x" }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Conflict" });
    }),
  ));
test("authorize input narrows with operation", () => {
  const policy = (
    args: Authorization<Inputs<typeof pages, typeof fields, number>>,
  ) => {
    if (args.operation === "update") {
      const title: string | undefined = args.input.data.title;
      return Effect.succeed(title !== "blocked");
    }
    return Effect.succeed(true);
  };
  expect(typeof policy).toBe("function");
});
test("denied access fails before database and disabled operations are absent", () => {
  const api = crud({
    table: pages,
    id: "id",
    store: sqliteStore(pages, Database.Service),
    fields,
    operations: { delete: false },
    access: { authorize: () => Effect.succeed(false) },
  });
  expect("delete" in api).toBe(false);
  return run(
    Effect.gen(function* () {
      yield* setup;
      expect(yield* api.list.decode({}).pipe(Effect.flip)).toMatchObject({
        _tag: "Forbidden",
      });
    }),
  );
});
test("deep filters and escaped wildcard text are handled", () =>
  run(
    Effect.gen(function* () {
      yield* setup;
      const api = resource();
      yield* api.create.decode({ title: "100%" });
      yield* api.create.decode({ title: "100X" });
      expect(
        (yield* api.list.decode({
          where: { field: "title", op: "contains", value: "%" },
        })).items,
      ).toEqual([{ id: 1, title: "100%" }]);
      let where: unknown = { field: "title", op: "eq", value: "100%" };
      for (let i = 0; i < 25; i++) where = { and: [where] };
      expect(yield* api.list.decode({ where }).pipe(Effect.flip)).toMatchObject(
        { _tag: "InvalidInput" },
      );
    }),
  ));
test("update hook cannot rewrite identifier", () =>
  run(
    Effect.gen(function* () {
      yield* setup;
      const api = crud({
        table: pages,
        id: "id",
        store: sqliteStore(pages, Database.Service),
        fields,
        access: "public",
        hooks: {
          beforeCreate: ({ data }) =>
            Effect.succeed({ ...data, owner: "alice" }),
          beforeUpdate: ({ data }) => Effect.succeed({ ...data, id: 99 }),
        },
      });
      yield* api.create.decode({ title: "first" });
      expect(
        yield* api.update
          .decode({ id: 1, data: { title: "second" } })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "InvalidInput" });
      expect(yield* api.get.decode({ id: 1 })).toEqual({
        id: 1,
        title: "first",
      });
    }),
  ));
