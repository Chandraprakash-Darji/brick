import { beforeAll, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineDatabase, defineService, sqliteTable, text, integer, syncSchema, resetGlobalRegistry, t, eq, and } from "@elregaldo/core";
import { compilePlans } from "../src/plans";
import { createNativeWorker } from "../src/native-worker";
import { startInProcessHttp } from "../src/native-bridge";
import { createBrickServer } from "../src/server";

const root = resolve(import.meta.dir, "../../..");
const compiler = resolve(root, "native/brickc/target/release/brickc");
const addon = resolve(root, "native/brick-http/target/release/brick-http.node");
beforeAll(async () => {
  const build = Bun.spawn([process.execPath, resolve(root, "scripts/build-native-http.ts")], { stdout: "ignore", stderr: "inherit" });
  expect(await build.exited).toBe(0);
  const compilerBuild = Bun.spawn(["cargo", "build", "--release", "--manifest-path", resolve(root, "native/brickc/Cargo.toml")], { stdout: "ignore", stderr: "inherit" });
  expect(await compilerBuild.exited).toBe(0);
}, 120000);

it("runs async Drizzle actions in-process with native validation, JS auth, raw endpoints, and native resource routes", async () => {
  resetGlobalRegistry();
  const directory = await mkdtemp(resolve(tmpdir(), "brick-bridge-test-"));
  const table = sqliteTable("pages", { id: text("id").primaryKey(), slug: text("slug").notNull(), isPublic: integer("is_public", { mode: "boolean" }).notNull() });
  const database = defineDatabase({ tables: [table], path: resolve(directory, "db.sqlite") });
  const db = database.getDb(); syncSchema(database.tables, db);
  await db.insert(table).values([{ id: "1", slug: "hello world", isPublic: true }, { id: "2", slug: "private", isPublic: false }]);
  let calls = 0; let contexts = 0;
  const pages = defineService("pages", { database, context: async ctx => { contexts++; return { user: { id: ctx.request.headers.get("x-user") } }; } });
  pages.action({ name: "getPublicPage", path: "/api/public/pages/:slug", input: t.Object({ slug: t.String({ minLength: 2 }) }),
    output: t.Object({ id: t.String(), slug: t.String(), isPublic: t.Boolean() }),
    errors: { NOT_FOUND: { status: 404, message: "Not found" } },
    execute: async ({ input, ctx, error }) => {
      calls++; await Bun.sleep(1);
      const [page] = await ctx.db.select().from(table).where(and(eq(table.slug, input.slug), eq(table.isPublic, true)));
      if (!page) error.NOT_FOUND(`Published page '/${input.slug}' not found or is private`);
      return page;
    } });
  pages.action({ name: "getSecret", authorize: ({ ctx }) => ctx.user?.id === "owner", execute: () => ({ ok: true }) });
  pages.action({ name: "getBadOutput", output: t.Object({ ok: t.Boolean() }), execute: () => ({ ok: "wrong" } as any) });
  pages.action({ name: "getCrash", execute: async () => { throw new Error("callback failure"); } });
  pages.action({ name: "getUndefined", output: t.Null(), execute: () => undefined as any });
  pages.action({ name: "getResponse", output: t.Object({}), execute: () => new Response("raw response") as any });
  pages.action({ name: "getEcho", input: t.Object({ count: t.Number(), active: t.Boolean() }), execute: ({ input }) => input });
  pages.action({ name: "getPattern", input: t.Object({ name: t.String({ pattern: "^ok$" }) }), execute: ({ input }) => input });
  const plain = defineService("plain", { database });
  // No slug column in this resource: a separate native-eligible table.
  const items = sqliteTable("items", { id: text("id").primaryKey(), title: text("title").notNull() });
  syncSchema([items], db); await db.insert(items).values({ id: "a", title: "Native" });
  plain.resource({ name: "item", table: items, defaultSort: "id", excludeFromList: [] });
  const services = [pages, plain];
  const plans = await compilePlans(services, { compiler, native: true });
  const baseline = createBrickServer({ services, docs: false, requestLogging: false });
  const app = createNativeWorker({ services, plans });
  app.endpoint({ method: "GET", path: "/raw/:name", handler: ({ params, set }) => { set.headers["content-type"] = "text/html"; return `<b>${params.name}</b>`; } });
  app.endpoint({ method: "GET", path: "/redirect", handler: () => Response.redirect("https://example.com/", 302) });
  app.endpoint({ method: "GET", path: "/cookies", handler: () => new Response("ok", { headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"]] }) });
  // A literal custom path must take precedence over a native resource's /:id.
  app.endpoint({ method: "GET", path: "/api/item/special", handler: () => ({ custom: true }) });
  expect(app.server).toBeUndefined();
  expect(app.nativeBindings().find(b => b.path === "/api/public/pages/:slug")?.nativeValidation).toBe(true);
  expect(app.nativeBindings().find(b => b.path === "/api/pages/getPattern")?.nativeValidation).toBe(false);
  try {
    await startInProcessHttp(app, services, plans, { port: 0, addon });
    const url = `http://127.0.0.1:${app.server!.port}`;
    for (const path of ["/api/public/pages/hello%20world", "/api/public/pages/private"]) {
      const expected = await baseline.handle(new Request(`http://localhost${path}`));
      const actual = await fetch(url + path, { headers: { "x-trace-id": "trace-native" } });
      expect(actual.status).toBe(expected.status);
      expect(await actual.json()).toEqual(await expected.json());
      expect(actual.headers.get("x-trace-id")).toBe("trace-native");
    }
    const beforeCalls = calls; const beforeContexts = contexts;
    const invalid = await fetch(url + "/api/public/pages/x");
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).name).toBe("ValidationError");
    expect(calls).toBe(beforeCalls); expect(contexts).toBe(beforeContexts);
    expect((await fetch(url + "/api/pages/getSecret")).status).toBe(403);
    expect((await fetch(url + "/api/pages/getSecret", { headers: { "x-user": "owner" } })).status).toBe(200);
    const bad = await fetch(url + "/api/pages/getBadOutput"); expect(bad.status).toBe(500);
    expect((await bad.json()).name).toBe("ValidationError");
    expect((await fetch(url + "/api/pages/getUndefined")).status).toBe(500);
    expect(await fetch(url + "/api/pages/getResponse").then(r => r.text())).toBe("raw response");
    const crash = await fetch(url + "/api/pages/getCrash"); expect(crash.status).toBe(500);
    expect((await crash.json()).message).toBe("callback failure");
    expect(await fetch(url + "/api/pages/getEcho?count=3&active=true").then(r => r.json())).toEqual({ count: 3, active: true });
    expect(await fetch(url + "/api/pages/getEcho?count=0x10&active=true").then(r => r.json())).toEqual({ count: 16, active: true });
    expect((await fetch(url + "/api/pages/getPattern?name=bad")).status).toBe(400);
    expect((await fetch(url + "/raw/hello").then(r => r.text()))).toBe("<b>hello</b>");
    const redirect = await fetch(url + "/redirect", { redirect: "manual" }); expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.com/");
    const cookies = await fetch(url + "/cookies"); expect(cookies.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(await fetch(url + "/api/item/special").then(r => r.json())).toEqual({ custom: true });
    expect(await fetch(url + "/api/item/a").then(r => r.json())).toEqual({ id: "a", title: "Native" });
    expect((await fetch(url + "/_health")).status).toBe(200);
    // Interleaved async callbacks must preserve request identities and results.
    const parallel = await Promise.all(Array.from({ length: 32 }, (_, i) => fetch(url + `/api/pages/getEcho?count=${i}&active=false`, { headers: { "x-request-id": `r${i}` } }).then(async r => [r.headers.get("x-request-id"), await r.json()])));
    parallel.forEach(([id, body], i) => { expect(id).toBe(`r${i}`); expect(body).toEqual({ count: i, active: false }); });
  } finally { await app.stop(); (db as any).$client.close(); await rm(directory, { recursive: true }); }
}, 30000);

it("rejects bind failures and stops while a JS Promise is pending without blocking Bun", async () => {
  resetGlobalRegistry(); const service = defineService("lifecycle");
  let entered!: () => void; const started = new Promise<void>(resolve => entered = resolve);
  let release!: () => void; const pending = new Promise<void>(resolve => release = resolve);
  service.action({ name: "getPending", execute: async () => { entered(); await pending; return { ok: true }; } });
  const plans = await compilePlans([service], { compiler, native: true });
  const app = createNativeWorker({ services: [service], plans, docs: false });
  const reserve = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  await expect(startInProcessHttp(app, [service], plans, { port: reserve.port!, addon })).rejects.toThrow();
  reserve.stop(true);
  await startInProcessHttp(app, [service], plans, { port: 0, addon });
  const request = fetch(`http://127.0.0.1:${app.server!.port}/api/lifecycle/getPending`).catch(() => null);
  await started;
  await app.stop(); await app.stop();
  release(); await request; await Bun.sleep(10);
  expect(app.server).toBeUndefined();
}, 30000);
