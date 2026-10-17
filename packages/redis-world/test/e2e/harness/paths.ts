import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The package under test. */
export const PKG_ROOT = join(here, "..", "..", "..");
export const E2E_DIR = join(PKG_ROOT, "test", "e2e");
export const DIST_DIR = join(PKG_ROOT, "dist");
export const SRC_DIR = join(PKG_ROOT, "src");
export const SERVER_ENTRY = join(E2E_DIR, "server", "server.mts");
export const TARGET_WORLD_ENTRY = join(E2E_DIR, "server", "target-world.mjs");
export const WF_BIN = join(PKG_ROOT, "node_modules", ".bin", "wf");
export const PACKAGE_NAME = "@brickkit/redis-world";
export const REDIS_SERVER_BIN = process.env.REDIS_SERVER_BIN ?? "redis-server";
/** The scratch Redis the e2e suite uses unless a test needs its own server. */
export const SCRATCH_REDIS_URL =
  process.env.E2E_REDIS_URL ?? "redis://localhost:6395";
