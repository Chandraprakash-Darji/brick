import { Context, Effect } from "effect";
import {
  sql,
  type Table,
  type InferSelectModel,
  type InferInsertModel,
  type SQL,
  type Column,
} from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { PgTable } from "drizzle-orm/pg-core";
import type { SqliteDatabase } from "./sqlite";
import type { PostgresDatabase } from "./postgres";
import type { SqlError } from "effect/sql";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
export interface Store<T extends Table, Db> {
  readonly list: (args: {
    where: SQL | undefined;
    order: SQL[];
    limit: number;
    offset: number;
  }) => Effect.Effect<InferSelectModel<T>[], EffectDrizzleQueryError, Db>;
  readonly count: (
    where: SQL | undefined,
  ) => Effect.Effect<number, EffectDrizzleQueryError, Db>;
  readonly create: (
    data: InferInsertModel<T>,
  ) => Effect.Effect<InferSelectModel<T>[], EffectDrizzleQueryError, Db>;
  readonly update: (
    data: Partial<InferInsertModel<T>>,
    where: SQL | undefined,
  ) => Effect.Effect<InferSelectModel<T>[], EffectDrizzleQueryError, Db>;
  readonly remove: (
    id: Column,
    where: SQL | undefined,
  ) => Effect.Effect<unknown[], EffectDrizzleQueryError, Db>;
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqlError.SqlError, R | Db>;
}
export function sqliteStore<T extends SQLiteTable, Db>(
  table: T,
  key: Context.Key<Db, SqliteDatabase>,
): Store<T, Db> {
  const runtime: SQLiteTable = table;
  const store: Store<T, Db> = {
    list: ({ where, order, limit, offset }) =>
      Effect.gen(function* () {
        const db = yield* key;
        return (yield* db
          .select()
          .from(runtime)
          .where(where)
          .orderBy(...order)
          .limit(limit)
          .offset(offset)) as InferSelectModel<T>[];
      }),
    count: (where) =>
      Effect.gen(function* () {
        const db = yield* key;
        return Number(
          (yield* db
            .select({ count: sql<number>`count(*)` })
            .from(runtime)
            .where(where))[0]?.count ?? 0,
        );
      }),
    create: (data) =>
      Effect.gen(function* () {
        const db = yield* key;
        return (yield* db
          .insert(runtime)
          .values(data)
          .returning()) as InferSelectModel<T>[];
      }),
    update: (data, where) =>
      Effect.gen(function* () {
        const db = yield* key;
        return (yield* db
          .update(runtime)
          .set(data)
          .where(where)
          .returning()) as InferSelectModel<T>[];
      }),
    remove: (id, where) =>
      Effect.gen(function* () {
        const db = yield* key;
        return yield* db
          .delete(runtime)
          .where(where)
          .returning({ id: sql`${id}` });
      }),
    transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(key, (db) => db.$client.withTransaction(effect)),
  };
  return Object.freeze(store);
}
export function postgresStore<T extends PgTable, Db>(
  table: T,
  key: Context.Key<Db, PostgresDatabase>,
): Store<T, Db> {
  const runtime: PgTable = table;
  const store: Store<T, Db> = {
    list: ({ where, order, limit, offset }) =>
      Effect.gen(function* () {
        const db = yield* key;
        return (yield* db
          .select()
          .from(runtime)
          .where(where)
          .orderBy(...order)
          .limit(limit)
          .offset(offset)) as InferSelectModel<T>[];
      }),
    count: (where) =>
      Effect.gen(function* () {
        const db = yield* key;
        return Number(
          (yield* db
            .select({ count: sql<number>`count(*)` })
            .from(runtime)
            .where(where))[0]?.count ?? 0,
        );
      }),
    create: (data) =>
      Effect.gen(function* () {
        const db = yield* key;
        return (yield* db
          .insert(runtime)
          .values(data)
          .returning()) as InferSelectModel<T>[];
      }),
    update: (data, where) =>
      Effect.gen(function* () {
        const db = yield* key;
        return (yield* db
          .update(runtime)
          .set(data)
          .where(where)
          .returning()) as InferSelectModel<T>[];
      }),
    remove: (id, where) =>
      Effect.gen(function* () {
        const db = yield* key;
        return yield* db
          .delete(runtime)
          .where(where)
          .returning({ id: sql`${id}` });
      }),
    transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(key, (db) => db.$client.withTransaction(effect)),
  };
  return Object.freeze(store);
}
