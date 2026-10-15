import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mcp } from "@better-auth/mcp";
import { Context, Effect, Layer } from "effect";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";

import { AuthDatabase } from "../db";
import { authSecret, baseUrlSecret, mcpResourceSecret } from "../secrets";
import { password } from "./password";
import * as schema from "./schema";

/**
 * Creates an isolated better-auth instance (email+password, 7-day sessions,
 * Go `server/main.go` parity). Schema must be prepared by the caller.
 */
export function createAuthInstance(
  db: Context.Service.Shape<typeof AuthDatabase>,
) {
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

export class Auth extends Context.Service<Auth, PagesAuth>()("pages/Auth") {}
export const authLayer = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const db = yield* AuthDatabase;
    const auth = createAuthInstance(db);
    yield* Effect.promise(() => auth.$context);
    return auth;
  }),
);
