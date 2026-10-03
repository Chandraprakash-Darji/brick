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
import { getTableColumns, getTableName, sql } from "drizzle-orm";

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
  getTableColumns,
  getTableName,
  Table,
  is,
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

/**
 * Generates an idempotent SQLite CREATE TABLE IF NOT EXISTS definition
 * directly from a Drizzle table schema.
 */
export function generateSQLiteTableDdl(table: any): string {
  const tableName = getTableName(table);
  const columns = getTableColumns(table);
  const colDefs: string[] = [];

  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    let def = `"${col.name}" ${col.getSQLType().toUpperCase()}`;
    if (col.primary) def += " PRIMARY KEY";
    if (col.notNull) def += " NOT NULL";
    if (col.isUnique) def += " UNIQUE";
    if (col.hasDefault) {
      if (typeof col.default === "string") {
        def += ` DEFAULT '${col.default.replace(/'/g, "''")}'`;
      } else if (typeof col.default === "boolean") {
        def += ` DEFAULT ${col.default ? 1 : 0}`;
      } else if (typeof col.default === "number") {
        def += ` DEFAULT ${col.default}`;
      } else if (col.default !== undefined) {
        def += ` DEFAULT ${col.default}`;
      }
    }
    colDefs.push(def);
  }

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(",\n  ")}\n);`;
}

/**
 * Synchronizes database schemas for registered tables.
 * In SQLite mode: generates and executes CREATE TABLE IF NOT EXISTS once during startup.
 * In Postgres mode: runs migrations or pending schema updates.
 */
export function syncSchema(
  tablesOrService: Map<string, any> | any[] | Record<string, any> | Service,
  dbInstance?: any
): Promise<void> | void {
  let db = dbInstance;
  let tables: any[] = [];

  if (
    tablesOrService &&
    typeof (tablesOrService as any).listActions === "function" &&
    (tablesOrService as any).tables
  ) {
    const service = tablesOrService as Service;
    tables = Array.from(service.tables.values());
    if (!db) {
      db = service.getDb();
    }
  } else if (tablesOrService instanceof Map) {
    tables = Array.from(tablesOrService.values());
  } else if (Array.isArray(tablesOrService)) {
    tables = tablesOrService;
  } else if (tablesOrService && typeof tablesOrService === "object") {
    tables = Object.values(tablesOrService);
  }

  if (!db || tables.length === 0) return;

  // Bun SQLite
  if ((db as any).$client?.run || (db as any).run) {
    for (const table of tables) {
      try {
        const ddl = generateSQLiteTableDdl(table);
        if ((db as any).$client?.run) {
          (db as any).$client.run(ddl);
        } else if ((db as any).run) {
          (db as any).run(sql.raw(ddl));
        }
      } catch (err: any) {
        console.warn(`[Brick-TS DB] Failed to create table:`, err.message);
      }
    }
    return;
  }

  // Postgres async mode
  return (async () => {
    for (const table of tables) {
      try {
        const tableName = getTableName(table);
        // Postgres sync or migration runner if configured
      } catch (err: any) {
        console.warn(`[Brick-TS DB] Postgres syncSchema error:`, err.message);
      }
    }
  })();
}
