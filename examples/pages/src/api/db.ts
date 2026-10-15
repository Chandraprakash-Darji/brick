import { Context, Effect, Layer, Redacted } from "effect";
import type { PostgresDatabase } from "@brickkit/crud/postgres";
import postgres from "postgres";
import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { drizzle } from "drizzle-orm/postgres-js";

export class PagesDatabase extends Context.Service<
  PagesDatabase,
  PostgresDatabase
>()("pages/Database") {}
export const databaseLayer = (url: string) =>
  Layer.effect(PagesDatabase, PgDrizzle.makeWithDefaults()).pipe(
    Layer.provide(PgClient.layer({ url: Redacted.make(url) })),
  );
export function makeAuthDatabase(url: string) {
  const sql = postgres(url, { prepare: false });
  return { db: drizzle({ client: sql }), close: () => sql.end() };
}
export class AuthDatabase extends Context.Service<
  AuthDatabase,
  ReturnType<typeof makeAuthDatabase>["db"]
>()("pages/AuthDatabase") {}
export const authDatabaseLayer = (url: string) =>
  Layer.effect(
    AuthDatabase,
    Effect.acquireRelease(
      Effect.sync(() => makeAuthDatabase(url)),
      (resource) => Effect.promise(() => resource.close()),
    ).pipe(Effect.map((resource) => resource.db)),
  );
