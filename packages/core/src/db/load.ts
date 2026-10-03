import { createRequire } from "node:module";

// Lazy loader for optional native database drivers.
//
// `bun:sqlite` only exists under Bun and `postgres` is an optional peer.
// Static imports would crash module load (e.g. a Node-based TanStack Start
// server importing `@brick-ts/core`) even when the engine is never used.
// Bun and CJS runtimes provide a global `require`; Node ESM falls back to
// a require rooted at this file so `drizzle-orm/*` resolves to the same
// copy the framework itself uses.
export function loadDriver(id: string): any {
  const runtimeRequire =
    (globalThis as any).require ?? createRequire(import.meta.url);
  return runtimeRequire(id);
}
