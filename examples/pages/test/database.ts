import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { buildApp } from "../src/api/app";
const configured = process.env.TEST_DATABASE_URL;
// Test-only fixture credential (overridable for CI); never shipped.
export const testPassword = process.env.TEST_PASSWORD ?? "correct-horse-8"; // NOSONAR
export const databaseTests = configured ? describeDatabase : null;
async function describeDatabase() {
  if (!configured) throw new Error("TEST_DATABASE_URL is required");
  const name = `brick_pages_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = postgres(configured, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(configured);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 1 });
  for (const file of readdirSync(join(import.meta.dir, "../drizzle"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const statement of readFileSync(
      join(import.meta.dir, "../drizzle", file),
      "utf8",
    ).split("--> statement-breakpoint"))
      if (statement.trim()) await sql.unsafe(statement);
  const app = buildApp({ databaseUrl: url.toString() });
  const request = (
    path: string,
    body?: unknown,
    cookie?: string,
    method?: string,
  ) =>
    app.fetch(
      new Request(`http://localhost:5174${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const signup = async (email: string) => {
    const response = await request("/api/auth/sign-up/email", {
      email,
      password: testPassword,
      name: "Native owner",
    });
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json();
    return { cookie: response.headers.get("set-cookie") ?? "", body };
  };
  return {
    app,
    sql,
    request,
    signup,
    async close() {
      await app.dispose();
      await sql.end();
      await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
export const prepareTestDatabase = describeDatabase;
