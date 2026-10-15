import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mcp } from "@better-auth/mcp";
import type { DatabaseHandle } from "@brickkit/core";
import type { PgDatabase } from "@brickkit/core/pg";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";

import { appDb } from "../db";
import { authSecret, baseUrlSecret, mcpResourceSecret } from "../secrets";
import { password } from "./password";
import * as schema from "./schema";

/**
 * Creates an isolated better-auth instance (email+password, 7-day sessions,
 * Go `server/main.go` parity). Schema must be prepared by the caller.
 */
export function createAuthInstance(
  database: DatabaseHandle<PgDatabase<any>> = appDb,
) {
  const db = database.getDb();

  const baseURL = baseUrlSecret.value() as string;
  const secretValue = authSecret.require();

  return betterAuth({
    baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      password,
      requireEmailVerification: false,
    },
    plugins: [
      jwt(),
      mcp({
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        consentPage: `${baseURL}/consent`,
        loginPage: `${baseURL}/login`,
        resource: mcpResourceSecret.value() as string,
        scopes: ["openid", "profile", "email", "offline_access", "read:pages"],
      }),
    ],
    secret: secretValue,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
    },
    trustedOrigins: [baseURL, "http://localhost:5174"],
  });
}

export type PagesAuth = ReturnType<typeof createAuthInstance>;

let current: PagesAuth | null = null;

export function initAuth(
  database: DatabaseHandle<PgDatabase<any>> = appDb,
): PagesAuth {
  current = createAuthInstance(database);
  return current;
}

/** Module auth instance; initAuth accepts a separate database when needed. */
export function getAuth(): PagesAuth {
  if (!current) {
    current = createAuthInstance();
  }
  return current;
}
