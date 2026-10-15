import { strict as assert } from "node:assert";
import { test } from "bun:test";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";

const url = process.env.BRICK_SPIKE_DATABASE_URL;

const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().unique().notNull(),
  emailVerified: boolean().notNull(),
  image: text(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
});
const session = pgTable("session", {
  id: text().primaryKey(),
  token: text().unique().notNull(),
  userId: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
  ipAddress: text(),
  userAgent: text(),
});
const account = pgTable("account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text().notNull(),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  scope: text(),
  password: text(),
  accessTokenExpiresAt: timestamp(),
  refreshTokenExpiresAt: timestamp(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
});
const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
});
const schema = { user, session, account, verification };

test.skipIf(!url)(
  "PostgreSQL Effect transactions coexist with real better-auth sessions",
  async () => {
    assert(
      url,
      "Set BRICK_SPIKE_DATABASE_URL to an isolated PostgreSQL database",
    );
    const databaseUrl = url;
    const email = `alice-${crypto.randomUUID()}@example.test`;
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, "emailVerified" boolean NOT NULL, image text, "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL);
    CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, token text UNIQUE NOT NULL, "userId" text NOT NULL, "expiresAt" timestamp NOT NULL, "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL, "ipAddress" text, "userAgent" text);
    CREATE TABLE IF NOT EXISTS account (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL, "accessToken" text, "refreshToken" text, "idToken" text, scope text, password text, "accessTokenExpiresAt" timestamp, "refreshTokenExpiresAt" timestamp, "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL);
    CREATE TABLE IF NOT EXISTS verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamp NOT NULL, "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL);`);
      const auth = betterAuth({
        baseURL: "http://localhost:3000",
        secret: "effect-native-spike-test-secret-minimum-32-chars",
        database: drizzleAdapter(drizzle({ client: pool }), {
          provider: "pg",
          schema,
        }),
        emailAndPassword: { enabled: true },
      });
      const signedUp = await auth.api.signUpEmail({
        body: {
          name: "Alice",
          email,
          password: "test-password-123",
        },
      });
      assert(signedUp.token);
      const login = await auth.api.signInEmail({
        body: { email, password: "test-password-123" },
        asResponse: true,
      });
      const cookie = login.headers
        .getSetCookie()
        .map((item) => item.split(";")[0])
        .join("; ");
      const resolved = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      assert.equal(resolved?.user.id, signedUp.user.id);
      class Aborted extends Schema.TaggedError<Aborted>()("Aborted", {}) {}
      class Database extends Context.Service<
        Database,
        PgDrizzle.EffectPgDatabase
      >()("spike/PgDatabase") {
        static layer = Layer.effect(
          Database,
          PgDrizzle.makeWithDefaults(),
        ).pipe(
          Layer.provide(
            PgClient.layer({
              url: Redacted.make(databaseUrl),
              maxConnections: 1,
            }),
          ),
        );
      }
      await Effect.runPromise(
        Effect.gen(function* () {
          const db = yield* Database;
          const users = yield* db
            .select()
            .from(user)
            .where(eq(user.id, signedUp.user.id));
          assert.equal(users[0]?.id, signedUp.user.id);
          yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* tx
                  .update(user)
                  .set({ name: "rolled back" })
                  .where(eq(user.id, signedUp.user.id));
                return yield* new Aborted();
              }),
            )
            .pipe(Effect.catchTag("Aborted", () => Effect.void));
          assert.equal(
            (yield* db
              .select()
              .from(user)
              .where(eq(user.id, signedUp.user.id)))[0]?.name,
            "Alice",
          );
          yield* db.transaction((tx) =>
            tx
              .update(user)
              .set({ name: "committed" })
              .where(eq(user.id, signedUp.user.id)),
          );
          assert.equal(
            (yield* db
              .select()
              .from(user)
              .where(eq(user.id, signedUp.user.id)))[0]?.name,
            "committed",
          );
        }).pipe(Effect.provide(Database.layer)),
      );
    } finally {
      await pool.end();
      assert(pool.ended);
    }
  },
);
