import type { Service } from "../types";
import {
  createSQLiteDatabase,
  type SQLiteDatabaseConfig,
  type BunSQLiteDatabase,
  type BrickSQLiteDatabase,
} from "./sqlite";
import {
  createPostgresDatabase,
  type PostgresDatabaseConfig,
  type PostgresDatabase,
} from "./postgres";

export * from "./sqlite";
export * from "./postgres";

// Re-export core Drizzle SQL expressions & operators for convenience
export {
  sql,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  desc,
  asc,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  like,
  ilike,
  relations,
} from "drizzle-orm";

export interface DatabaseConfig<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> extends SQLiteDatabaseConfig<TSchema>,
    PostgresDatabaseConfig<TSchema> {
  /** Database engine. Default: 'sqlite' */
  engine?: "sqlite" | "postgres" | "clickhouse";
  /** Optional service name associated with this database */
  name?: string;
}

export type BrickDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> = BunSQLiteDatabase<TSchema> | PostgresDatabase<TSchema>;

/**
 * Creates a database instance based on the provided configuration.
 * Zero-config: calling `createDatabase()` returns an ultra-fast Bun-native SQLite
 * database in `:memory:` mode wrapped with Drizzle ORM.
 */
export function createDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>
>(config: DatabaseConfig<TSchema> = {}): BunSQLiteDatabase<TSchema> | PostgresDatabase<TSchema> {
  const engine = config.engine ?? "sqlite";

  if (engine === "sqlite") {
    return createSQLiteDatabase<TSchema>(config);
  }

  if (engine === "postgres") {
    return createPostgresDatabase<TSchema>(config);
  }

  throw new Error(`[Brick-TS DB] Unsupported database engine: '${engine}'`);
}

/**
 * Attaches a Drizzle database instance to a service.
 * Accepts either:
 *  - A `DatabaseConfig` object
 *  - A boolean (true for default zero-config SQLite)
 *  - An existing Drizzle instance
 *  - undefined (defaults to zero-config SQLite)
 *
 * Sets `service.setDb(db)` and returns the initialized Drizzle instance.
 */
export function attachDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>
>(
  service: Service,
  config?: DatabaseConfig<TSchema> | boolean
): BunSQLiteDatabase<TSchema> | PostgresDatabase<TSchema>;
export function attachDatabase<TDb extends object>(
  service: Service,
  dbInstance: TDb
): TDb;
export function attachDatabase(
  service: Service,
  configOrDb?: any
): any {
  let db: any;

  if (
    configOrDb &&
    typeof configOrDb === "object" &&
    ("select" in configOrDb || "query" in configOrDb)
  ) {
    db = configOrDb;
  } else {
    const config =
      typeof configOrDb === "object" && configOrDb !== null
        ? (configOrDb as DatabaseConfig)
        : undefined;
    db = createDatabase(config);
  }

  service.setDb(db);
  return db;
}
