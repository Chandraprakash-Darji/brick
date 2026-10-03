import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
export {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/sqlite-core";

export interface SQLiteDatabaseConfig<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> {
  /** Database file path or ':memory:' (default: ':memory:') */
  path?: string;
  /** Alias for path */
  filename?: string;
  /** Whether to enable WAL journal mode for file-based DBs (default: true) */
  wal?: boolean;
  /** Whether to enforce foreign key constraints (default: true) */
  foreignKeys?: boolean;
  /** Optional existing bun:sqlite Database instance */
  client?: Database;
  /** Optional Drizzle schema object for typed relational queries */
  schema?: TSchema;
}

export type BrickSQLiteDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> = BunSQLiteDatabase<TSchema> & {
  $client: Database;
};

/**
 * Creates a zero-config SQLite database using Bun's native `bun:sqlite` engine
 * and Drizzle ORM. Defaults to an ultra-fast in-memory database (`:memory:`).
 */
export function createSQLiteDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>
>(config: SQLiteDatabaseConfig<TSchema> = {}): BunSQLiteDatabase<TSchema> {
  const filePath = config.filename ?? config.path ?? ":memory:";
  const client = config.client ?? new Database(filePath);

  if (config.foreignKeys !== false) {
    client.run("PRAGMA foreign_keys = ON;");
  }

  if (config.wal !== false && filePath !== ":memory:") {
    client.run("PRAGMA journal_mode = WAL;");
  }

  const db = (
    config.schema ? drizzle(client, { schema: config.schema }) : drizzle(client)
  ) as BunSQLiteDatabase<TSchema>;

  if (!(db as any).$client) {
    (db as any).$client = client;
  }

  return db;
}
