import { createRequire } from "node:module";

// Lazy loader for the optional Bun-only SQLite driver.
//
// `bun:sqlite` only exists under Bun, so it stays lazy: static imports
// would crash module load on Node. `postgres` used to load this way too,
// but Nitro/Rollup cannot trace runtime `require(id)` calls — the Vercel
// function bundle shipped without the driver and failed at runtime.
// `postgres` and `drizzle-orm/*` are hard dependencies, so `postgres.ts`
// imports them statically; only `bun:sqlite` uses this loader.
export function loadDriver(id: string): any {
  const runtimeRequire =
    (globalThis as any).require ?? createRequire(import.meta.url);
  return runtimeRequire(id);
}
