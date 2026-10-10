import { test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { defineService, defineDatabase } from "@brickkit/core";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { crud } from "../src";

const records = sqliteTable("where_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  active: integer("active", { mode: "boolean" }).default(true),
});

let sequence = 0;
function fixture() {
  const database = defineDatabase({ tables: [records] });
  const db = database.getDb();
  const sqlite = (db as typeof db & { $client: Database }).$client;
  sqlite.exec(
    "CREATE TABLE where_records (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT,active INTEGER DEFAULT 1)",
  );
  const service = defineService(`where_test_${sequence++}`, { database });
  const resource: any = service
    .resource({ name: "record", table: records, id: records.id })
    .use(
      crud({
        fields: {
          id: {
            read: true,
            filter: [
              "eq",
              "ne",
              "in",
              "notIn",
              "gt",
              "gte",
              "lt",
              "lte",
              "between",
              "isNull",
              "isNotNull",
            ],
          },
          name: {
            read: true,
            create: true,
            filter: [
              "eq",
              "ne",
              "in",
              "notIn",
              "gt",
              "gte",
              "lt",
              "lte",
              "between",
              "contains",
              "startsWith",
              "endsWith",
              "isNull",
              "isNotNull",
            ],
          },
          email: {
            read: true,
            create: true,
            filter: ["eq", "ne", "in", "isNull", "isNotNull"],
          },
          active: { read: true, create: true, filter: ["eq"] },
        },
      }),
    );
  return { sqlite, resource };
}

async function seed(resource: any) {
  await resource.create.run({ name: "Alice", email: "alice@example.com" });
  await resource.create.run({ name: "Bob", email: null });
  await resource.create.run({ name: "Carol", email: "carol@example.com" });
}

test("where schema groups leaves into named per-field unions", () => {
  const { resource, sqlite } = fixture();
  try {
    const where = resource.list.config.input.properties.where;
    expect(where.$id).toBe("CrudWhere:record");
    // Every top-level member is a named $ref: no anonymous inline leaves.
    const memberRefs = where.anyOf.map((member: any) => member.$ref);
    expect(memberRefs).toEqual([
      "CrudWhere:record:id",
      "CrudWhere:record:name",
      "CrudWhere:record:email",
      "CrudWhere:record:active",
      "CrudWhere:record:and",
      "CrudWhere:record:or",
    ]);
    const defs = where.anyOf[0].$defs;
    expect(defs["CrudWhere:record:name"].title).toBe("Where:record:name");
    expect(defs["CrudWhere:record:and"].title).toBe("Where:record:and");
    expect(defs["CrudWhere:record:or"].title).toBe("Where:record:or");
    // Exact per-op value shapes survive the grouping.
    const byOp = Object.fromEntries(
      defs["CrudWhere:record:id"].anyOf.map((leaf: any) => [
        leaf.properties.op.const,
        leaf,
      ]),
    );
    expect(Object.keys(byOp).sort()).toEqual([
      "between",
      "eq",
      "gt",
      "gte",
      "in",
      "isNotNull",
      "isNull",
      "lt",
      "lte",
      "ne",
      "notIn",
    ]);
    expect(byOp.in.properties.value).toMatchObject({
      type: "array",
      minItems: 1,
      maxItems: 1000,
    });
    expect(byOp.between.properties.value.items).toHaveLength(2);
    expect(byOp.isNull.required).toEqual(["field", "op"]);
    expect(byOp.isNull.properties.value).toBeUndefined();
    expect(byOp.eq.properties.value).toMatchObject({ type: "number" });
    // Compiles without blowup and stays shared: one function per $id.
    const compiled = TypeCompiler.Compile(where);
    expect(compiled.Code().match(/function check_/g)?.length).toBeLessThan(40);
    expect(compiled.Check({ field: "id", op: "eq", value: 1 })).toBe(true);
  } finally {
    sqlite.close();
  }
});

test("every filter operator shape validates and filters", async () => {
  const { resource, sqlite } = fixture();
  try {
    await seed(resource);
    const names = async (where: unknown) =>
      ((await resource.list.run({ where, select: ["name"] })) as any).items.map(
        (row: any) => row.name,
      );
    expect(await names({ field: "id", op: "eq", value: 1 })).toEqual(["Alice"]);
    expect(await names({ field: "id", op: "ne", value: 1 })).toEqual([
      "Bob",
      "Carol",
    ]);
    expect(await names({ field: "id", op: "in", value: [1, 3] })).toEqual([
      "Alice",
      "Carol",
    ]);
    expect(await names({ field: "id", op: "notIn", value: [1, 3] })).toEqual([
      "Bob",
    ]);
    expect(await names({ field: "id", op: "gt", value: 1 })).toEqual([
      "Bob",
      "Carol",
    ]);
    expect(await names({ field: "id", op: "gte", value: 2 })).toEqual([
      "Bob",
      "Carol",
    ]);
    expect(await names({ field: "id", op: "lt", value: 3 })).toEqual([
      "Alice",
      "Bob",
    ]);
    expect(await names({ field: "id", op: "lte", value: 2 })).toEqual([
      "Alice",
      "Bob",
    ]);
    expect(await names({ field: "id", op: "between", value: [2, 3] })).toEqual([
      "Bob",
      "Carol",
    ]);
    expect(await names({ field: "name", op: "contains", value: "o" })).toEqual([
      "Bob",
      "Carol",
    ]);
    expect(
      await names({ field: "name", op: "startsWith", value: "A" }),
    ).toEqual(["Alice"]);
    expect(await names({ field: "name", op: "endsWith", value: "b" })).toEqual([
      "Bob",
    ]);
    expect(await names({ field: "name", op: "isNull" })).toEqual([]);
    expect(await names({ field: "name", op: "isNotNull" })).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
    expect(await names({ field: "email", op: "isNull" })).toEqual(["Bob"]);
    expect(await names({ field: "email", op: "eq", value: "x" })).toEqual([]);
    expect(await names({ field: "active", op: "eq", value: true })).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
    // Nesting across named branches.
    expect(
      await resource.count.run({
        where: {
          or: [
            { field: "id", op: "eq", value: 1 },
            {
              and: [
                { field: "name", op: "startsWith", value: "C" },
                { field: "email", op: "isNotNull" },
              ],
            },
          ],
        },
      }),
    ).toEqual({ count: 2 });
    expect(
      await names({
        and: [
          { field: "id", op: "gte", value: 1 },
          { or: [{ field: "email", op: "isNull" }] },
        ],
      }),
    ).toEqual(["Bob"]);
  } finally {
    sqlite.close();
  }
});

test("malformed where shapes reject with 400", async () => {
  const { resource, sqlite } = fixture();
  try {
    await seed(resource);
    for (const where of [
      { field: "id", op: "eq", value: "1" },
      { field: "id", op: "in", value: [] },
      { field: "id", op: "between", value: [1] },
      { field: "id", op: "isNull", value: 1 },
      { field: "email", op: "eq", value: null },
      { field: "name", op: "eq", value: 1, extra: true },
      { field: "active", op: "contains", value: "x" },
      { field: "missing", op: "eq", value: "x" },
      { field: "id", op: "nope", value: 1 },
      { and: [] },
      { or: [{ field: "id", op: "eq", value: 1 }, { bad: true }] },
      { unknown: true },
    ])
      await expect(
        resource.list.run({ where: where as never }),
      ).rejects.toMatchObject({ status: 400 });
  } finally {
    sqlite.close();
  }
});

test("filter fields colliding with branch names fail fast", () => {
  const odd = sqliteTable("where_odd", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    and: text("and"),
  });
  const database = defineDatabase({ tables: [odd] });
  const service = defineService("where_collision", { database });
  expect(() =>
    service.resource({ name: "record", table: odd, id: odd.id }).use(
      crud({
        fields: { id: { read: true }, and: { read: true, filter: ["eq"] } },
      }),
    ),
  ).toThrow("collides with the 'and' branch");
  const oddOr = sqliteTable("where_odd_or", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    or: text("or"),
  });
  const databaseOr = defineDatabase({ tables: [oddOr] });
  const serviceOr = defineService("where_collision_or", {
    database: databaseOr,
  });
  expect(() =>
    serviceOr.resource({ name: "record", table: oddOr, id: oddOr.id }).use(
      crud({
        fields: { id: { read: true }, or: { read: true, filter: ["eq"] } },
      }),
    ),
  ).toThrow("collides with the 'or' branch");
});
