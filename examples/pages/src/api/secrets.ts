import { secret, envSource } from "@brickkit/core";

// Single declaration site for every pages env var. Values load from
// process.env (Bun populates it from .env locally); boot validation in
// createBrickServer fails fast on missing required secrets.

// PORT defaults to 5174; non-numeric/non-positive values throw at boot.
export const portSecret = secret("PORT")
  .default("5174")
  .transform((raw) => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid port: ${raw}`);
    return n;
  });

// Validated when set; loadEnv falls back to http://localhost:<PORT>.
export const baseUrlSecret = secret("BASE_URL")
  .default(`http://localhost:${portSecret.value()}`)
  .url();

// Shared pages/auth Postgres database; DATABASE_URL selects the database.
// Local dev default targets the `drafton` database on localhost.
export const databaseUrlSecret = secret("DATABASE_URL").default(
  "postgresql://localhost:5432/drafton",
);

// MCP protected-resource identifier (RFC 8707); defaults to <BASE_URL>/mcp.
export const mcpResourceSecret = secret("MCP_RESOURCE")
  .default(`${baseUrlSecret.value()}/mcp`)
  .url();

const isProd = envSource.get("NODE_ENV") === "production";

// Required in prod (boot throws when missing); insecure dev default locally.
export const authSecret = secret(
  "AUTH_SECRET",
  isProd ? {} : { default: "pages-dev-secret" },
);

export function warnOnAuthDefault(): void {
  if (!isProd && envSource.get("AUTH_SECRET") === undefined) {
    console.warn(
      "[pages auth] AUTH_SECRET not set — using insecure dev default",
    );
  }
}
