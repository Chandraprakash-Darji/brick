import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineSecret, envSource } from "@brickkit/core";

// Single declaration site for every pages env var. Values load from
// process.env (Bun populates it from .env locally); boot validation in
// brick() fails fast on missing required secrets.

// PORT defaults to 5174; non-numeric/non-positive values throw at boot.
export const portSecret = defineSecret("PORT")
  .default("5174")
  .transform((raw) => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid port: ${raw}`);
    return n;
  });

// Validated when set; loadEnv falls back to http://localhost:<PORT>.
export const baseUrlSecret = defineSecret("BASE_URL")
  .default(`http://localhost:${portSecret.value()}`)
  .url();

// Shared pages/auth Postgres database; DATABASE_URL selects the database.
// Local dev default targets the `drafton` database on localhost.
export const databaseUrlSecret = defineSecret("DATABASE_URL").default(
  "postgresql://localhost:5432/drafton",
);

// MCP protected-resource identifier (RFC 8707); defaults to <BASE_URL>/mcp.
export const mcpResourceSecret = defineSecret("MCP_RESOURCE")
  .default(`${baseUrlSecret.value()}/mcp`)
  .url();

const isProd = envSource.get("NODE_ENV") === "production";

/**
 * A random signing secret for local development, made once and kept in
 * `.brick/auth-secret` (which git ignores), so sessions survive restarts and
 * nothing weak is ever used. Better Auth warns about short or guessable
 * secrets, as a fixed string in the source would be.
 */
function developmentAuthSecret(): string {
  const folder = join(process.cwd(), ".brick");
  const file = join(folder, "auth-secret");
  const stored = () => {
    try {
      const value = readFileSync(file, "utf8").trim();
      return value.length >= 32 ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const existing = stored();
  if (existing) return existing;
  const generated = randomBytes(32).toString("hex");
  try {
    mkdirSync(folder, { recursive: true });
    // `.brick/` is where dashboard history lives; it keeps itself out of git.
    writeFileSync(join(folder, ".gitignore"), "*\n", { flag: "wx" });
  } catch {
    // Already there, or the folder cannot be written; the next step decides.
  }
  try {
    // Exclusive, so two processes starting together end up with the same one.
    writeFileSync(file, generated, { flag: "wx", mode: 0o600 });
    return generated;
  } catch {
    // Another process made it first, or nothing can be saved: then this
    // process keeps its own, and its sessions last until it restarts.
    return stored() ?? generated;
  }
}

// Required in prod (boot throws when missing). Locally, one is generated, unless
// AUTH_SECRET is set.
export const authSecret = defineSecret(
  "AUTH_SECRET",
  isProd || envSource.get("AUTH_SECRET") !== undefined
    ? {}
    : { default: developmentAuthSecret() },
);
