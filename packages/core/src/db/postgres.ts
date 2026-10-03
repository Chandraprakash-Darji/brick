import { loadDriver } from "./load";

export interface PostgresDatabaseConfig<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> {
  /** Database connection URL (e.g. postgresql://user:pass@host:5432/dbname) */
  url?: string;
  /** Connection string alias */
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | "require" | "allow" | "prefer" | "verify-full";
  max?: number;
  /**
   * Disable prepared statements (required for transaction-mode poolers such
   * as Supabase's Supavisor on :6543, which cannot hold named prepared
   * statements across transactions).
   */
  prepare?: boolean;
  /** Optional Drizzle schema for relational queries */
  schema?: TSchema;
  /** Custom schema name for Encore-style isolated schemas */
  schemaName?: string;
}

export type PostgresDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> = any;

export interface DatabaseAdapter<TDb = any, TConfig = any> {
  createDatabase(config?: TConfig): TDb;
}

/**
 * Creates a PostgreSQL Drizzle instance using postgres-js.
 * Lazily loads 'postgres' and 'drizzle-orm/postgres-js' at runtime so
 * importing `@brick/core` never requires the optional peer installed.
 * Works on Bun, Node CJS, and Node ESM.
 */
export function createPostgresDatabase<
  TSchema extends Record<string, unknown> = Record<string, unknown>
>(config: PostgresDatabaseConfig<TSchema> = {}): PostgresDatabase<TSchema> {
  const connectionUrl =
    config.url ??
    config.connectionString ??
    (typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined);

  try {
    const postgresModule = loadDriver("postgres");
    // CJS require returns the callable directly; ESM-interop loaders
    // (e.g. the better-auth CLI config loader) hand back a namespace.
    const postgres = postgresModule?.default ?? postgresModule;
    const postgresJs = loadDriver("drizzle-orm/postgres-js");
    const drizzle =
      postgresJs?.drizzle ?? postgresJs?.default?.drizzle ?? postgresJs;

    const client = connectionUrl
      ? postgres(connectionUrl, {
          max: config.max,
          prepare: config.prepare,
          ssl: config.ssl,
        })
      : postgres({
          host: config.host ?? "localhost",
          port: config.port ?? 5432,
          user: config.user,
          password: config.password,
          database: config.database,
          max: config.max,
          prepare: config.prepare,
          ssl: config.ssl,
        });

    return drizzle(client, {
      schema: config.schema,
      ...(config.schemaName ? { schemaFilter: [config.schemaName] } : {}),
    });
  } catch (err: any) {
    if (
      err?.code === "MODULE_NOT_FOUND" ||
      err?.message?.includes("Cannot find package")
    ) {
      throw new Error(
        `[Brick-TS DB] PostgreSQL integration requires the 'postgres' package. Please install it using 'bun add postgres'. Original error: ${err.message}`
      );
    }
    throw err;
  }
}
