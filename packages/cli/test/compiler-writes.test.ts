import { beforeEach, expect, it } from "bun:test";
import {
  defineDatabase,
  defineService,
  resetGlobalRegistry,
  syncSchema,
  sqliteTable,
  text,
  integer,
  t,
  sql,
} from "@brickkit/core";
import { brick } from "../src/server";

beforeEach(resetGlobalRegistry);
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const request = (method: string, path: string, body?: any) =>
  new Request("http://localhost" + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

function fixture(table: any, compiler: boolean, extra: any = {}) {
  const database = defineDatabase({ tables: [table] });
  const db = database.getDb() as any;
  syncSchema(database.tables, db);
  const statements: string[] = [];
  db.session.logger = { logQuery: (query: string) => statements.push(query) };
  let sequence = 0;
  const service = defineService(
    compiler ? "compiled_writes" : "generic_writes",
    {
      database,
      context: () => ({ logger }),
    },
  );
  service.resource({
    name: "item",
    table,
    defaultSort: "id",
    idGenerator: () => `id-${sequence++}`,
    ...extra,
  });
  const app = brick({ services: [service], compiler, requestLogging: false });
  return { app, service, db, statements };
}

it("primes INSERT/UPDATE and removes readback queries, retaining column encoders and mapped rows", async () => {
  const table = sqliteTable("fast_writes", {
    id: text("row_id").primaryKey(),
    title: text("headline").notNull(),
    published: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    payload: text("payload", { mode: "json" }).notNull(),
  });
  const a = fixture(table, true, { fields: { payload: t.Any() } }),
    b = fixture(table, false, { fields: { payload: t.Any() } });
  try {
    let builds = 0;
    for (const method of ["insert", "update"]) {
      const original = a.db[method].bind(a.db);
      a.db[method] = (...args: any[]) => {
        builds++;
        return original(...args);
      };
    }
    for (let i = 0; i < 2; i++) {
      const input = {
        title: `Title ${i}`,
        payload: { value: i },
        ...(i ? { published: true } : {}),
      };
      a.statements.length = b.statements.length = 0;
      const x = await a.app.handle(request("POST", "/api/item", input)),
        y = await b.app.handle(request("POST", "/api/item", input));
      expect(x.status).toBe(200);
      expect(y.status).toBe(200);
      const row = await x.json();
      expect(row).toEqual(await y.json());
      expect(row.payload).toEqual({ value: i });
      expect(row.published).toBe(Boolean(i));
      expect(a.statements).toHaveLength(1);
      expect(a.statements[0]).toContain("returning");
      expect(b.statements).toHaveLength(2);
      a.statements.length = b.statements.length = 0;
      const input2 = { title: `Changed ${i}` };
      const u = await a.app.handle(
          request("PATCH", `/api/item/id-${i}`, input2),
        ),
        v = await b.app.handle(request("PATCH", `/api/item/id-${i}`, input2));
      expect(u.status).toBe(200);
      expect(await u.json()).toEqual(await v.json());
      expect(a.statements).toHaveLength(2);
      expect(a.statements[0]).toContain("select");
      expect(a.statements[1]).toContain("returning");
      expect(b.statements).toHaveLength(3);
    }
    expect(builds).toBe(0);
  } finally {
    a.db.$client.close();
    b.db.$client.close();
  }
});

it("does not evaluate or freeze omitted JavaScript defaults while compiling write shapes", async () => {
  let defaults = 0,
    updates = 0;
  const table = sqliteTable("write_defaults", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    token: text("token")
      .notNull()
      .$defaultFn(() => `token-${++defaults}`),
    changed: integer("changed")
      .notNull()
      .$onUpdateFn(() => ++updates),
  });
  const a = fixture(table, true);
  try {
    expect(defaults).toBe(0);
    expect(updates).toBe(0);
    for (let i = 0; i < 2; i++) {
      const res = await a.app.handle(
        request("POST", "/api/item", { title: `Item ${i}` }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).token).toBe(`token-${i + 1}`);
    }
    expect(defaults).toBe(2);
    expect(updates).toBe(2);
    const updated = await a.app.handle(
      request("PATCH", "/api/item/id-0", { title: "Changed" }),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).changed).toBe(3);
    expect(defaults).toBe(2);
    expect(updates).toBe(3);
  } finally {
    a.db.$client.close();
  }
});

it("refreshes trigger handling after DDL, including TEMP triggers, and returns post-trigger rows", async () => {
  const table = sqliteTable("trigger_writes", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
  });
  const a = fixture(table, true),
    b = fixture(table, false);
  try {
    const compare = async (
      method: string,
      path: string,
      input: any,
      title: string,
    ) => {
      const x = await a.app.handle(request(method, path, input)),
        y = await b.app.handle(request(method, path, input));
      expect(x.status).toBe(200);
      expect(y.status).toBe(200);
      const row = await x.json();
      expect(row).toEqual(await y.json());
      expect(row.title).toBe(title);
    };
    await compare(
      "POST",
      "/api/item",
      { title: "Before triggers" },
      "Before triggers",
    );
    for (const f of [a, b])
      f.db.$client
        .exec(`CREATE TRIGGER write_after_insert AFTER INSERT ON trigger_writes
      BEGIN UPDATE trigger_writes SET title = 'After insert trigger' WHERE id = NEW.id; END`);
    a.statements.length = 0;
    await compare(
      "POST",
      "/api/item",
      { title: "Input" },
      "After insert trigger",
    );
    expect(a.statements).toHaveLength(2);
    expect(a.statements[0]).not.toContain("returning");
    for (const f of [a, b])
      f.db.$client
        .exec(`CREATE TEMP TRIGGER write_after_update AFTER UPDATE ON main.trigger_writes
      BEGIN UPDATE trigger_writes SET title = 'After update trigger' WHERE id = NEW.id; END`);
    await compare(
      "PATCH",
      "/api/item/id-0",
      { title: "Updated" },
      "After update trigger",
    );
    for (const f of [a, b])
      f.db.$client.exec(
        "DROP TRIGGER write_after_insert; DROP TRIGGER temp.write_after_update",
      );
    a.statements.length = 0;
    await compare(
      "PATCH",
      "/api/item/id-0",
      { title: "No triggers" },
      "No triggers",
    );
    expect(a.statements).toHaveLength(2);
    expect(a.statements[1]).toContain("returning");
  } finally {
    a.db.$client.close();
    b.db.$client.close();
  }
});

it("preserves hook SQL expressions and lookup-key changes instead of replaying or changing writes", async () => {
  const table = sqliteTable("hook_writes", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
  });
  const hooks = {
    beforeCreate: ({ data }: any) => {
      if (data.title === "Duplicate") data.id = "renamed";
    },
    beforeUpdate: ({ data }: any) => {
      if (data.title === "rename") data.id = "renamed";
      else data.title = sql`upper(${data.title})`;
    },
  };
  const a = fixture(table, true, { hooks }),
    b = fixture(table, false, { hooks });
  try {
    for (const f of [a, b])
      await f.app.handle(request("POST", "/api/item", { title: "Original" }));
    for (const title of ["lowercase", "rename"]) {
      const x = await a.app.handle(
          request("PATCH", "/api/item/id-0", { title }),
        ),
        y = await b.app.handle(request("PATCH", "/api/item/id-0", { title }));
      expect(x.status).toBe(200);
      expect(await x.json()).toEqual(await y.json());
      expect(a.db.select().from(table).all()).toEqual(
        b.db.select().from(table).all(),
      );
    }
    // An execution error must be surfaced after exactly one attempted prepared write.
    a.statements.length = 0;
    const conflict = await a.app.handle(
      request("POST", "/api/item", { title: "Duplicate" }),
    );
    expect(conflict.status).toBe(500);
    expect(
      a.statements.filter((query) => query.startsWith("insert")),
    ).toHaveLength(1);
  } finally {
    a.db.$client.close();
    b.db.$client.close();
  }
});

it("bounds optional-field shape caches and still executes uncached combinations correctly", async () => {
  const optional = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [`field${i}`, text(`field_${i}`)]),
  );
  const table = sqliteTable("bounded_writes", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    ...optional,
  });
  const a = fixture(table, true);
  try {
    let builds = 0;
    const insert = a.db.insert.bind(a.db);
    a.db.insert = (...args: any[]) => {
      builds++;
      return insert(...args);
    };
    const create = async (mask: number) => {
      const fields = Object.fromEntries(
        Array.from({ length: 7 }, (_, i) => [`field${i}`, `value-${i}`]).filter(
          (_, i) => mask & (1 << i),
        ),
      );
      const res = await a.app.handle(
        request("POST", "/api/item", { title: "Optional", ...fields }),
      );
      expect(res.status).toBe(200);
      const row = await res.json();
      for (let i = 0; i < 7; i++)
        expect(row[`field${i}`]).toBe(mask & (1 << i) ? `value-${i}` : null);
    };
    for (let mask = 0; mask < 128; mask++) await create(mask);
    builds = 0;
    await create(1);
    expect(builds).toBe(0); // Early prepared shapes remain reusable.
    await create(64);
    expect(builds).toBe(1); // Cache is full: dynamic query + original readback.
    await create(64);
    expect(builds).toBe(2);
  } finally {
    a.db.$client.close();
  }
});

it("keeps dynamic writes for a database supplied by request context", async () => {
  const table = sqliteTable("context_writes", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
  });
  const primary = defineDatabase({ tables: [table] }),
    secondary = defineDatabase({ tables: [table] });
  const first = primary.getDb() as any,
    second = secondary.getDb() as any;
  syncSchema(primary.tables, first);
  syncSchema(secondary.tables, second);
  const service = defineService("context_writes", {
    database: primary,
    context: () => ({ db: second, logger }),
  });
  service.resource({
    name: "item",
    table,
    idGenerator: () => "other-db",
    defaultSort: "id",
  });
  const app = brick({ services: [service], requestLogging: false });
  try {
    const created = await app.handle(
      request("POST", "/api/item", { title: "Secondary" }),
    );
    expect(created.status).toBe(200);
    expect((await created.json()).title).toBe("Secondary");
    const updated = await app.handle(
      request("PATCH", "/api/item/other-db", { title: "Changed" }),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).title).toBe("Changed");
    expect(first.select().from(table).all()).toHaveLength(0);
    expect(second.select().from(table).all()).toEqual([
      { id: "other-db", title: "Changed" },
    ]);
  } finally {
    first.$client.close();
    second.$client.close();
  }
});

it("does not consume hook accessors while deciding whether to use the prepared path", async () => {
  const table = sqliteTable("accessor_writes", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
  });
  const setup = (compiler: boolean) => {
    let reads = 0;
    const hooks = {
      beforeCreate: ({ data }: any) =>
        Object.defineProperty(data, "title", {
          enumerable: true,
          get: () => `Value ${++reads}`,
        }),
    };
    return { ...fixture(table, compiler, { hooks }), reads: () => reads };
  };
  const a = setup(true),
    b = setup(false);
  try {
    const x = await a.app.handle(
      request("POST", "/api/item", { title: "Input" }),
    );
    const y = await b.app.handle(
      request("POST", "/api/item", { title: "Input" }),
    );
    expect(x.status).toBe(200);
    expect(await x.json()).toEqual(await y.json());
    expect(a.reads()).toBe(1);
    expect(b.reads()).toBe(1);
  } finally {
    a.db.$client.close();
    b.db.$client.close();
  }
});

it("keeps SELECT readback semantics when the resource lookup field is not unique", async () => {
  const table = sqliteTable("nonunique_writes", {
    id: text("id").notNull(),
    title: text("title").notNull(),
  });
  const a = fixture(table, true, { idGenerator: () => "shared" }),
    b = fixture(table, false, { idGenerator: () => "shared" });
  try {
    for (const title of ["First", "Second"]) {
      const x = await a.app.handle(request("POST", "/api/item", { title })),
        y = await b.app.handle(request("POST", "/api/item", { title }));
      expect(x.status).toBe(200);
      expect(y.status).toBe(200);
      const row = await x.json();
      expect(row).toEqual(await y.json());
      expect(row.title).toBe("First");
    }
    expect(a.db.select().from(table).all()).toEqual(
      b.db.select().from(table).all(),
    );
    expect(
      a.statements
        .filter((query) => query.startsWith("insert"))
        .every((query) => !query.includes("returning")),
    ).toBe(true);
  } finally {
    a.db.$client.close();
    b.db.$client.close();
  }
});
