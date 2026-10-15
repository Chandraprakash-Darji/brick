import { Context, Effect, Layer } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as Drizzle from "drizzle-orm/effect-sqlite-bun";
export type SqliteDatabase = Effect.Success<
  ReturnType<typeof Drizzle.makeWithDefaults>
>;
export const sqliteDatabase =
  <Self>() =>
  (
    name: string,
    config: SqliteClient.SqliteClientConfig,
  ): {
    readonly Service: Context.Service<Self, SqliteDatabase>;
    readonly layer: Layer.Layer<
      Self,
      Layer.Error<ReturnType<typeof SqliteClient.layer>>
    >;
  } => {
    class Service extends Context.Service<Self, SqliteDatabase>()(name) {}
    const layer = Layer.effect(Service, Drizzle.makeWithDefaults()).pipe(
      Layer.provide(SqliteClient.layer(config)),
    );
    return Object.freeze({ Service, layer });
  };
