import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Table, getTableName } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { SecretRef } from "../secrets";
import {
  createSQLiteDatabase,
  type SQLiteDatabaseConfig,
  type BunSQLiteDatabase,
} from "./sqlite";
import {
  createPostgresDatabase,
  type PostgresDatabaseConfig,
} from "./postgres";

export type EnvInput<T> = T | SecretRef<T>;
type EnvOptions<T> = { [K in keyof T]: EnvInput<Exclude<T[K], undefined>> };

interface DefinitionOptions<TSchema extends Record<string, unknown>> {
  name?: string;
  /** Drizzle tables retained for schema tooling. Never applied at runtime. */
  tables?: (TSchema & Record<string, Table>) | readonly Table[];
  schema?: TSchema;
}

export type SQLiteDefinition<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> = DefinitionOptions<TSchema> &
  EnvOptions<Omit<SQLiteDatabaseConfig<TSchema>, "schema" | "client">> & {
    engine?: "sqlite";
    client?: SQLiteDatabaseConfig<TSchema>["client"];
    url?: never;
    connectionString?: never;
  };

export type PostgresDefinition<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> = DefinitionOptions<TSchema> &
  EnvOptions<Omit<PostgresDatabaseConfig<TSchema>, "schema" | "client">> & {
    engine: "postgres";
    path?: never;
    filename?: never;
    wal?: never;
    foreignKeys?: never;
    client?: PostgresDatabaseConfig<TSchema>["client"];
  };

export type DatabaseDefinition<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> = SQLiteDefinition<TSchema> | PostgresDefinition<TSchema>;

export interface DatabaseHandle<
  TDb,
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly kind: "brick-database";
  readonly name?: string;
  readonly engine: "sqlite" | "postgres";
  readonly tables: Readonly<Record<string, Table>>;
  readonly schema: TSchema;
  getDb(): TDb;
}

export function isDatabaseHandle(
  value: unknown,
): value is DatabaseHandle<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "brick-database"
  );
}

export function defineDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  options?: SQLiteDefinition<TSchema>,
): DatabaseHandle<BunSQLiteDatabase<TSchema>, TSchema>;
export function defineDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  options: PostgresDefinition<TSchema>,
): DatabaseHandle<PostgresJsDatabase<TSchema> & { $client: Sql }, TSchema>;
export function defineDatabase(
  options: DatabaseDefinition = {},
): DatabaseHandle<unknown> {
  const engine = options.engine ?? "sqlite";
  if (engine !== "sqlite" && engine !== "postgres") {
    throw new Error(`Unsupported database engine: ${engine}`);
  }
  const forbidden =
    engine === "sqlite"
      ? [
          "url",
          "connectionString",
          "host",
          "port",
          "user",
          "password",
          "database",
          "ssl",
          "max",
          "schemaName",
        ]
      : ["path", "filename", "wal", "foreignKeys"];
  for (const key of forbidden) {
    if (key in options)
      throw new Error(`Database option "${key}" is not valid for ${engine}`);
  }
  const declared = options.tables ?? {};
  const tables: Record<string, Table> = Array.isArray(declared)
    ? Object.fromEntries(declared.map((table) => [getTableName(table), table]))
    : { ...declared };
  const schema = options.schema ?? tables;
  let db: unknown;

  return {
    kind: "brick-database",
    name: options.name,
    engine,
    tables: Object.freeze(tables),
    schema,
    getDb() {
      if (db !== undefined) return db;
      const config: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(options)) {
        if (["tables", "schema", "name", "engine"].includes(key)) continue;
        // An injected Postgres client already owns all connection settings.
        if (
          engine === "postgres" &&
          options.client &&
          key !== "client" &&
          key !== "schemaName"
        )
          continue;
        config[key] = value instanceof SecretRef ? value.require() : value;
      }
      if (engine === "sqlite") {
        const path = (config.filename ?? config.path ?? ":memory:") as string;
        if (!config.client && path !== ":memory:")
          mkdirSync(dirname(path), { recursive: true });
        const instance = createSQLiteDatabase({ ...config, schema });
        db = instance;
      } else {
        db = createPostgresDatabase({ ...config, schema });
      }
      return db;
    },
  };
}
