import { Context, Effect, Layer } from "effect";
import { PgClient } from "@effect/sql-pg";
import * as Drizzle from "drizzle-orm/effect-postgres";
export type PostgresDatabase = Effect.Success<
  ReturnType<typeof Drizzle.makeWithDefaults>
>;
export const postgresDatabase =
  <Self>() =>
  (
    name: string,
    config: PgClient.PgClientConfig,
  ): {
    readonly Service: Context.Service<Self, PostgresDatabase>;
    readonly layer: Layer.Layer<
      Self,
      Layer.Error<ReturnType<typeof PgClient.layer>>
    >;
  } => {
    class Service extends Context.Service<Self, PostgresDatabase>()(name) {}
    const layer = Layer.effect(Service, Drizzle.makeWithDefaults()).pipe(
      Layer.provide(PgClient.layer(config)),
    );
    return Object.freeze({ Service, layer });
  };
