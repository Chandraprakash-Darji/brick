import { test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { defineService, defineDatabase } from "@brickkit/core";
import { crud } from "../src";

const records = sqliteTable("records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  email: text("email"),
  private: text("private"),
  active: integer("active", { mode: "boolean" }).default(true),
});
let sequence = 0;
function fixture(
  options: Parameters<typeof crud>[0] = {
    fields: {
      id: { read: true, filter: ["eq", "in"] },
      name: {
        read: true,
        create: true,
        update: true,
        filter: ["eq", "contains"],
        sort: true,
      },
      email: {
        read: true,
        create: true,
        scrub: ({ value }) => (value === null ? null : "masked"),
      },
      active: { read: true, create: true },
    },
  },
) {
  const database = defineDatabase({ tables: [records] });
  const db = database.getDb();
  const sqlite = (db as typeof db & { $client: Database }).$client;
  sqlite.exec(
    "CREATE TABLE records (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,email TEXT,private TEXT,active INTEGER DEFAULT 1)",
  );
  const service = defineService(`test_${sequence++}`, { database });
  const resource: any = service
    .resource({ name: "record", table: records, id: records.id })
    .use(crud(options));
  return { sqlite, db, resource, service };
}
test("defaults, explicit fields, scrubbing and writes use real database", async () => {
  const { resource: r, sqlite } = fixture();
  try {
    expect(await r.create.run({ name: "A", email: "a@example.com" })).toEqual({
      id: 1,
      name: "A",
      email: "masked",
      active: true,
    });
    expect(await r.get.run({ id: 1 })).toEqual({
      id: 1,
      name: "A",
      email: "masked",
      active: true,
    });
    expect(await r.update.run({ id: 1, data: { name: "B" } })).toMatchObject({
      name: "B",
      email: "masked",
    });
    expect(await r.list.run({ includeTotal: true })).toEqual({
      items: [{ id: 1, name: "B", email: "masked", active: true }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(await r.delete.run({ id: 1 })).toEqual({ success: true });
    await expect(r.get.run({ id: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await r.findOne.run({})).toBeNull();
  } finally {
    sqlite.close();
  }
});
test("filter AST, selection, total opt-in and bounded prepared reuse", async () => {
  const { resource: r, sqlite } = fixture();
  try {
    await r.create.run({ name: "A%" });
    await r.create.run({ name: "Other" });
    expect(
      await r.list.run({
        where: { field: "name", op: "contains", value: "%" },
        select: ["name"],
      }),
    ).toEqual({ items: [{ name: "A%" }], limit: 20, offset: 0 });
    expect(
      await r.count.run({
        where: {
          or: [
            { field: "id", op: "eq", value: 1 },
            { field: "name", op: "eq", value: "Other" },
          ],
        },
      }),
    ).toEqual({ count: 2 });
    expect(
      await r.count.run({ where: { field: "id", op: "in", value: [2] } }),
    ).toEqual({ count: 1 });
    expect(
      await r.exists.run({ where: { field: "id", op: "eq", value: 99 } }),
    ).toEqual({ exists: false });
    expect(await r.list.run({ select: ["id"], limit: 1, offset: 1 })).toEqual({
      items: [{ id: 2 }],
      limit: 1,
      offset: 1,
    });
  } finally {
    sqlite.close();
  }
});
test("rejects hidden fields, unknown fields, operators and invalid write input", async () => {
  const { resource: r, sqlite } = fixture();
  try {
    for (const input of [
      { select: ["private"] },
      { where: { field: "email", op: "eq", value: "x" } },
      { where: { field: "name", op: "in", value: ["x"] } },
      { limit: 101 },
      { unknown: true },
    ])
      await expect(r.list.run(input as never)).rejects.toMatchObject({
        status: 400,
      });
    await expect(
      r.create.run({ name: "A", private: "secret" } as never),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      r.update.run({ id: 1, data: { email: "x" } } as never),
    ).rejects.toMatchObject({ status: 400 });
  } finally {
    sqlite.close();
  }
});
test("scope protects all reads and mutations even local actions", async () => {
  const {
    resource: r,
    db,
    sqlite,
  } = fixture({
    fields: { id: { read: true }, name: { read: true, update: true } },
    access: {
      scope: ({ operation }) =>
        operation === "create" ? undefined : eq(records.id, 1),
    },
  });
  try {
    await db.insert(records).values([{ name: "allowed" }, { name: "hidden" }]);
    expect((await r.list.run({})).items).toEqual([{ id: 1, name: "allowed" }]);
    expect(await r.count.run({})).toEqual({ count: 1 });
    expect(await r.exists.run({})).toEqual({ exists: true });
    await expect(r.get.run({ id: 2 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      r.update.run({ id: 2, data: { name: "bad" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(r.delete.run({ id: 2 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await db.select().from(records))[1].name).toBe("hidden");
  } finally {
    sqlite.close();
  }
});
test("operation disabling removes local capabilities", () => {
  const { resource: r, sqlite } = fixture({
    fields: { id: { read: true } },
    operations: { delete: false, create: false },
  });
  try {
    expect("delete" in r).toBe(false);
    expect("create" in r).toBe(false);
    expect(typeof r.count).toBe("function");
  } finally {
    sqlite.close();
  }
});
test("trusted hooks can supply internal fields without exposing them", async () => {
  const hooks: string[] = [];
  const {
    resource: r,
    db,
    sqlite,
  } = fixture({
    fields: {
      id: { read: true },
      name: { read: true, create: true, update: true },
    },
    hooks: {
      beforeCreate: ({ data }) => {
        data.private = "internal";
        hooks.push("beforeCreate");
      },
      afterCreate: ({ row }) => {
        expect(row.private).toBe("internal");
        hooks.push("afterCreate");
      },
      beforeUpdate: () => {
        hooks.push("beforeUpdate");
      },
      afterUpdate: () => {
        hooks.push("afterUpdate");
      },
      beforeDelete: () => {
        hooks.push("beforeDelete");
      },
      afterDelete: () => {
        hooks.push("afterDelete");
      },
    },
  });
  try {
    expect(await r.create.run({ name: "A" })).toEqual({ id: 1, name: "A" });
    expect((await db.select().from(records))[0].private).toBe("internal");
    await r.update.run({ id: 1, data: { name: "B" } });
    await r.delete.run({ id: 1 });
    expect(hooks).toEqual([
      "beforeCreate",
      "afterCreate",
      "beforeUpdate",
      "afterUpdate",
      "beforeDelete",
      "afterDelete",
    ]);
  } finally {
    sqlite.close();
  }
});
test("authorization and scoped-create rejection do not modify storage", async () => {
  const {
    resource: r,
    db,
    sqlite,
  } = fixture({
    fields: { name: { create: true, read: true } },
    access: {
      authorize: ({ operation }) => operation !== "delete",
      scope: () => eq(records.id, 1),
    },
  });
  try {
    await expect(r.create.run({ name: "A" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(r.delete.run({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await db.select().from(records)).toEqual([]);
  } finally {
    sqlite.close();
  }
});
test("preparation prewarming preserves projection and repeated IDs", async () => {
  const { resource: r, service, sqlite } = fixture();
  try {
    service.prepareContributions();
    await r.create.run({ name: "A" });
    await r.create.run({ name: "B" });
    expect((await r.get.run({ id: 1 })).name).toBe("A");
    expect((await r.get.run({ id: 2 })).name).toBe("B");
    expect((await r.list.run({})).items).toHaveLength(2);
    expect(
      (await r.list.run({ select: ["name"], limit: 1, offset: 1 })).items,
    ).toEqual([{ name: "B" }]);
  } finally {
    sqlite.close();
  }
});

test("unique database constraints return conflict without modifying the existing row", async () => {
  const { resource: r, sqlite } = fixture();
  try {
    await r.create.run({ name: "A" });
    await expect(r.create.run({ name: "A" })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
    expect(await r.count.run({})).toEqual({ count: 1 });
  } finally {
    sqlite.close();
  }
});

test("deeply nested where rejects with 400 before validation recurses", async () => {
  const { resource: r, sqlite } = fixture({
    fields: {
      id: { read: true },
      name: { read: true, filter: ["eq"] },
    },
  });
  try {
    const deepWhere = (depth: number): unknown => {
      let node: unknown = { field: "name", op: "eq", value: "x" };
      for (let i = 0; i < depth; i++) node = { and: [node] };
      return node;
    };
    // Past the 20-level bound but below any generic HTTP nesting cap.
    await expect(
      r.list.run({ where: deepWhere(64) as never }),
    ).rejects.toMatchObject({ status: 400 });
    // Deep enough to overflow the compiled validator's recursion without
    // the pre-validation walk (RangeError instead of a 400).
    await expect(
      r.list.run({ where: deepWhere(500) as never }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      r.count.run({ where: deepWhere(20_000) as never }),
    ).rejects.toMatchObject({ status: 400 });
  } finally {
    sqlite.close();
  }
});

test("boolean columns are sortable", async () => {
  const { resource: r, sqlite } = fixture({
    fields: {
      id: { read: true },
      name: { read: true, create: true },
      active: { read: true, create: true, sort: true },
    },
  });
  try {
    await r.create.run({ name: "on", active: true });
    await r.create.run({ name: "off", active: false });
    expect(
      await r.list.run({
        select: ["name"],
        orderBy: [{ field: "active", direction: "asc" }],
      }),
    ).toEqual({
      items: [{ name: "off" }, { name: "on" }],
      limit: 20,
      offset: 0,
    });
    expect(
      await r.list.run({
        select: ["name"],
        orderBy: [{ field: "active", direction: "desc" }],
      }),
    ).toEqual({
      items: [{ name: "on" }, { name: "off" }],
      limit: 20,
      offset: 0,
    });
  } finally {
    sqlite.close();
  }
});
