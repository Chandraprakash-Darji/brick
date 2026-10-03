// Postgres schema builders, re-exported from the framework's own drizzle-orm
// copy. Import tables from `@brick/core/pg` (never `drizzle-orm/pg-core`
// directly): table objects must be created by the same module instance the
// framework runtime uses, otherwise brand-symbol identity breaks.
//
// This entry is deliberately separate from the package root: several builder
// names (`text`, `integer`, `index`, …) exist in both `sqlite-core` and
// `pg-core` with different implementations, so they cannot share one barrel.

export {
  pgTable,
  pgEnum,
  pgSchema,
  pgView,
  boolean,
  timestamp,
  date,
  time,
  text,
  varchar,
  char,
  uuid,
  integer,
  bigint,
  smallint,
  serial,
  bigserial,
  real,
  doublePrecision,
  numeric,
  decimal,
  json,
  jsonb,
  interval,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";

export { relations, sql } from "drizzle-orm";

export type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/** Typed Postgres Drizzle instance, as held by `defineDatabase({engine})`. */
export type PgDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> = PostgresJsDatabase<TSchema>;
