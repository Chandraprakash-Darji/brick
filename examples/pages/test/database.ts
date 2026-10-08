import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defineDatabase, getTableName } from "@brickkit/core";
import postgres from "postgres";

import { initAuth } from "../src/api/auth";
import { appDb } from "../src/api/db";
import { pagesService } from "../src/api/services/pages/service";

// Postgres-backed test databases. Tests run under Bun; the Start server
// runs the same code on Node (no bun:sqlite anywhere in this chain).
// Override with TEST_DATABASE_URL; the database is created on demand.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/drafton_test";

function dbName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

// Committed migrations (`bun run db:generate`) are the single schema source:
// applying them here also proves they actually run on Postgres.
async function migrateOnce(url: string): Promise<void> {
  const name = dbName(url);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1 });
  try {
    const found =
      await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (found.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }
  const sql = postgres(url, { max: 1 });
  try {
    const present = await sql`
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pages'`;
    if (present.length > 0) return; // already migrated; shared across runs
    const dir = join(import.meta.dir, "../drizzle");
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const statements = readFileSync(join(dir, file), "utf8").split(
        "--> statement-breakpoint",
      );
      for (const raw of statements) {
        const stmt = raw.trim();
        if (stmt) await sql.unsafe(stmt);
      }
    }
  } finally {
    await sql.end();
  }
}

let migratedUrl: string | null = null;

async function truncateAll(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    const names = Object.values(appDb.schema)
      .map((table) => `"${getTableName(table as never)}"`)
      .join(", ");
    await sql.unsafe(`TRUNCATE TABLE ${names} CASCADE`);
  } finally {
    await sql.end();
  }
}

/**
 * Fresh isolated database: migrate once per process, empty every call
 * (TRUNCATE … CASCADE), then point the service + auth singletons at it.
 */
export async function prepareTestDatabase() {
  if (migratedUrl !== TEST_DATABASE_URL) {
    await migrateOnce(TEST_DATABASE_URL);
    migratedUrl = TEST_DATABASE_URL;
  }
  await truncateAll(TEST_DATABASE_URL);
  const database = defineDatabase({
    engine: "postgres",
    tables: appDb.schema,
    client: postgres(TEST_DATABASE_URL, { max: 1 }),
  });
  pagesService.setDb(database);
  initAuth(database);
  return database;
}
