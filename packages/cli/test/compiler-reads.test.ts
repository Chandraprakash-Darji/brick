import { beforeEach, expect, it } from "bun:test";
import { defineDatabase, defineService, resetGlobalRegistry, syncSchema, sqliteTable, text, integer, eq } from "@brickkit/core";
import { createBrickServer } from "../src/server";
import { compileBrickApplication } from "../src/compiler";

beforeEach(resetGlobalRegistry);
const table = sqliteTable("compiled_read_rows", {
  id: text("row_id").primaryKey(), title: text("headline").notNull(), content: text("body").notNull(),
  userId: text("owner_id").notNull(), published: integer("is_published", { mode: "boolean" }).notNull(),
});
function fixture(name: string) {
  const database = defineDatabase({ tables: [table] });
  const db = database.getDb();
  syncSchema(database.tables, db);
  db.insert(table).values([
    { id: "a", title: "Alpha", content: "large A", userId: "alice", published: true },
    { id: "b", title: "Beta", content: "large B", userId: "bob", published: false },
    { id: "c", title: "Gamma", content: "large C", userId: "alice", published: true },
    { id: "d", title: "Delta", content: "large D", userId: "alice", published: false },
  ]).run();
  db.$client.exec('CREATE VIRTUAL TABLE compiled_read_rows_fts USING fts5(id UNINDEXED, title)');
  db.$client.exec('INSERT INTO compiled_read_rows_fts(id, title) SELECT row_id, headline FROM compiled_read_rows');
  const service = defineService(name, { database, context: ctx => ({ user: ctx.request.headers.has("x-user") ? { id: ctx.request.headers.get("x-user")! } : null }) });
  service.resource({ name: "item", table, ownerField: "userId", defaultSort: "title", operations: { list: { defaultLimit: 2, maxLimit: 10 } } });
  return { service, db };
}
function request(path: string, user?: string) { return new Request("http://localhost" + path, { headers: user ? { "x-user": user } : {} }); }

it("compiles GET/list/count SQL before requests and preserves mapping, owner scope and live rows", async () => {
  const { service, db } = fixture("compiled");
  try {
    const compilation = compileBrickApplication({ services: [service] });
    expect(compilation.ir.reads[0]!.get).toContain('"row_id"');
    expect(compilation.ir.reads[0]!.ownerList).toContain('"owner_id"');
    expect(compilation.ir.reads[0]!.count).toContain("count(*)");
    const app = createBrickServer({ services: [service], compilation, requestLogging: false });
    let builds = 0;
    const original = db.select.bind(db);
    (db as any).select = (...args: any[]) => { builds++; return original(...args as []); };
    const get = await app.handle(request("/api/item/a", "alice"));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: "a", title: "Alpha", content: "large A", userId: "alice", published: true });
    expect((await app.handle(request("/api/item/b", "alice"))).status).toBe(403);
    expect((await app.handle(request("/api/item/missing", "alice"))).status).toBe(404);
    const list = await (await app.handle(request("/api/item?limit=2", "alice"))).json();
    expect(list.total).toBe(3);
    expect(list.items.map((row: any) => row.id)).toEqual(["a", "d"]);
    expect(list.items[0].published).toBe(true);
    expect(list.items[0].content).toBeUndefined();
    expect(list.nextCursor).toBeTruthy();
    expect(builds).toBe(0);
    db.insert(table).values({ id: "e", title: "Epsilon", content: "new", userId: "alice", published: true }).run();
    const updated = await (await app.handle(request("/api/item?limit=2&page=2", "alice"))).json();
    expect(updated.total).toBe(4);
    expect(updated.items.map((row: any) => row.id)).toEqual(["e", "c"]);
    expect(updated.pageCount).toBe(2);
    expect(updated.hasMore).toBe(false);
    expect(builds).toBe(0);
    const anonymous = await (await app.handle(request("/api/item?limit=10"))).json();
    expect(anonymous.total).toBe(5);
    const bob = await (await app.handle(request("/api/item?limit=10", "bob"))).json();
    expect(bob.total).toBe(1);
    expect(bob.items.map((row: any) => row.id)).toEqual(["b"]);
    db.update(table).set({ title: "Changed" }).where(eq(table.id, "a")).run();
    expect((await (await app.handle(request("/api/item/a", "alice"))).json()).title).toBe("Changed");
    expect(builds).toBe(0);
  } finally { db.$client.close(); }
});

it("matches the general query path for pagination, projection, filters, custom sorting and cursors", async () => {
  const candidate = fixture("candidate"), baseline = fixture("baseline");
  try {
    const app = createBrickServer({ services: [candidate.service], requestLogging: false });
    const generic = createBrickServer({ services: [baseline.service], requestLogging: false, compiler: false });
    const paths = ["/api/item?limit=2", "/api/item?limit=2&page=2", "/api/item?limit=1&offset=2", "/api/item?limit=2&sort=-title",
      "/api/item?limit=2&published=true", "/api/item?limit=2&select=id,title", "/api/item?limit=2&sort=invalid", "/api/item?limit=2&search=Alpha", "/api/item?limit=99", "/api/item/a", "/api/item/b"];
    for (const path of paths) {
      const a = await app.handle(request(path, "alice")), b = await generic.handle(request(path, "alice"));
      expect(a.status).toBe(b.status);
      expect(await a.json()).toEqual(await b.json());
    }
    const first = await (await app.handle(request("/api/item?limit=1", "alice"))).json();
    const path = "/api/item?limit=1&cursor=" + encodeURIComponent(first.nextCursor);
    const a = await app.handle(request(path, "alice")), b = await generic.handle(request(path, "alice"));
    expect(await a.json()).toEqual(await b.json());
  } finally { candidate.db.$client.close(); baseline.db.$client.close(); }
});

it("separates read caches for identically named resources on a shared database", async () => {
  const a = sqliteTable("table_a", { id: text("id").primaryKey(), title: text("title").notNull() });
  const b = sqliteTable("table_b", { id: text("id").primaryKey(), title: text("title").notNull() });
  const database = defineDatabase({ tables: [a, b] });
  const db = database.getDb(); syncSchema(database.tables, db);
  try {
    db.insert(a).values({ id: "same", title: "A" }).run(); db.insert(b).values({ id: "same", title: "B" }).run();
    const one = defineService("one", { database }), two = defineService("two", { database });
    one.resource({ name: "item", table: a, defaultSort: "id" }); two.resource({ name: "item", table: b, defaultSort: "id" });
    const app = createBrickServer({ services: [one, two], requestLogging: false });
    for (const [service, title] of [["one", "A"], ["two", "B"]]) {
      const response = await app.handle(new Request(`http://localhost/api/${service}/item.get`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"id":"same"}' }));
      expect((await response.json()).title).toBe(title);
      const list = await app.handle(new Request(`http://localhost/api/${service}/item.list`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"limit":10}' }));
      expect((await list.json()).items[0].title).toBe(title);
    }
  } finally { db.$client.close(); }
});

it("specializes every CRUD method while preserving hooks, ownership, errors and persisted writes", async () => {
  const table = sqliteTable("crud_rows", { id: text("id").primaryKey(), title: text("title").notNull(), userId: text("user_id") });
  function setup(name: string, compiler: boolean) {
    const database = defineDatabase({ tables: [table] });
    const db = database.getDb(); syncSchema(database.tables, db);
    const hooks: string[] = [];
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const service = defineService(name, { database, context: ctx => ({ user: { id: ctx.request.headers.get("x-user")! }, logger }) });
    service.resource({ name: "record", table, ownerField: "userId", defaultSort: "id", idGenerator: () => "fixed-id",
      hooks: {
        beforeCreate: ({ data }) => { data.title = data.title.trim(); hooks.push("beforeCreate"); },
        afterCreate: () => { hooks.push("afterCreate"); },
        beforeUpdate: ({ data }) => { if (data.title) data.title = data.title.trim(); hooks.push("beforeUpdate"); },
        afterUpdate: () => { hooks.push("afterUpdate"); },
        beforeDelete: () => { hooks.push("beforeDelete"); },
        afterDelete: () => { hooks.push("afterDelete"); },
      } });
    const compilation = compileBrickApplication({ services: [service], mode: compiler ? "specialized" : "generic" });
    expect(compilation.ir.routes.filter(route => route.kind === "resource").map(route => route.method).sort())
      .toEqual(["GET", "GET", "POST", "PATCH", "PUT", "DELETE"].sort());
    return { app: createBrickServer({ services: [service], compilation, compiler, requestLogging: false }), db, hooks };
  }
  const a = setup("compiled_crud", true), b = setup("generic_crud", false);
  const commands = [
    { method: "POST", path: "/api/record", body: { title: " First " } },
    { method: "GET", path: "/api/record/fixed-id" },
    { method: "PATCH", path: "/api/record/fixed-id", body: { title: " Patched " } },
    { method: "PUT", path: "/api/record/fixed-id", body: { title: " Replaced " } },
    { method: "DELETE", path: "/api/record/fixed-id", user: "bob" },
    { method: "DELETE", path: "/api/record/fixed-id" },
    { method: "GET", path: "/api/record/fixed-id" },
    { method: "POST", path: "/api/record", body: {} },
  ];
  try {
    const statuses: number[] = [];
    for (const command of commands) {
      const req = () => new Request("http://localhost" + command.path, { method: command.method,
        headers: { "content-type": "application/json", "x-user": command.user ?? "alice" },
        ...(command.body ? { body: JSON.stringify(command.body) } : {}) });
      const x = await a.app.handle(req()), y = await b.app.handle(req());
      statuses.push(x.status);
      expect(x.status).toBe(y.status);
      expect(await x.json()).toEqual(await y.json());
      expect(a.db.select().from(table).all()).toEqual(b.db.select().from(table).all());
      expect(a.hooks).toEqual(b.hooks);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 403, 200, 404, 400]);
    expect(a.hooks).toEqual(["beforeCreate", "afterCreate", "beforeUpdate", "afterUpdate", "beforeUpdate", "afterUpdate", "beforeDelete", "afterDelete"]);
  } finally { a.db.$client.close(); b.db.$client.close(); }
});
