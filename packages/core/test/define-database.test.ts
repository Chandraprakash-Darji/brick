import { describe, it, expect } from "bun:test";
import {
  defineDatabase,
  defineService,
  sqliteTable,
  text,
  SecretRef,
  attachDatabase,
  syncSchema,
  type BunSQLiteDatabase,
} from "../src";

const items = sqliteTable("defined_items", { id: text("id").primaryKey() });
const other = sqliteTable("defined_other", { id: text("id").primaryKey() });

describe("defineDatabase", () => {
  it("shares one typed Drizzle instance between services", async () => {
    const database = defineDatabase({ tables: { items } });
    syncSchema(database.tables, database.getDb());
    const a = defineService("defined_a", { database });
    const b = defineService("defined_b", { database });
    expect(a.getDb()).toBe(database.getDb());
    expect(b.getDb()).toBe(a.getDb());
    await a.getDb()!.insert(items).values({ id: "shared" });
    const rows = await b.getDb()!.query.items.findMany();
    expect(rows[0]?.id).toBe("shared");
    const ctx = await b.resolveContext();
    expect(await ctx.db.query.items.findMany()).toHaveLength(1);
    expect(database.schema.items).toBe(items);
    expect(database.tables.items).toBe(items);
  });

  it("keeps separate definitions isolated", async () => {
    const a = defineDatabase({ tables: [items] });
    const b = defineDatabase({ tables: [items] });
    syncSchema(a.tables, a.getDb());
    syncSchema(b.tables, b.getDb());
    await a.getDb().insert(items).values({ id: "only-a" });
    expect(await b.getDb().select().from(items)).toHaveLength(0);
    expect(a.getDb()).not.toBe(b.getDb());
  });

  it("resolves and validates env inputs lazily, including transformed options", () => {
    const path = new SecretRef("BRICK_DEFINED_PATH");
    const wal = new SecretRef("BRICK_DEFINED_WAL", {
      default: "false",
    }).transform((v) => v === "true");
    const database = defineDatabase({ path, wal, tables: { items } });
    const service = defineService("defined_lazy", { database });
    service.resource({ name: "item", table: items });
    expect(() => database.getDb()).toThrow("BRICK_DEFINED_PATH");
    path.default(":memory:");
    expect(service.getDb()).toBe(database.getDb());
    const invalid = new SecretRef("BRICK_DEFINED_INVALID", {
      default: "bad",
    }).validate(() => false);
    expect(() => defineDatabase({ path: invalid }).getDb()).toThrow(
      "BRICK_DEFINED_INVALID",
    );
  });

  it("registers service tables without creating them, even after opening the database", () => {
    const database = defineDatabase();
    const a = defineService("defined_tables_a", { database });
    const b = defineService("defined_tables_b", { database });
    a.registerTable(items);
    b.registerTable(other);
    expect(() => a.getDb()!.select().from(items).all()).toThrow();
    expect(() => b.getDb()!.select().from(other).all()).toThrow();
    a.registerTable(other);
    expect(() => a.getDb()!.select().from(other).all()).toThrow();
  });

  it("never applies declared tables at runtime", () => {
    const database = defineDatabase({ tables: { items } });
    const service = defineService("defined_migrations", { database });
    service.registerTable(items);
    service.resource({ name: "item", table: items });
    expect(() => database.getDb().select().from(items).all()).toThrow();
    expect(database.tables.items).toBe(items);
  });

  it("supports attachDatabase without treating a handle as a config", () => {
    const database = defineDatabase({ tables: { items } });
    const service = defineService("defined_attached");
    expect(attachDatabase(service, database)).toBe(database.getDb());
    expect(service.getDb()).toBe(database.getDb());
  });

  it("rejects incompatible engine fields at runtime", () => {
    // @ts-expect-error SQLite cannot take a Postgres URL.
    expect(() =>
      defineDatabase({ engine: "sqlite", url: "postgres://localhost/db" }),
    ).toThrow("url");
    // @ts-expect-error Postgres cannot take a SQLite path.
    expect(() =>
      defineDatabase({ engine: "postgres", path: ":memory:" }),
    ).toThrow("path");
  });

  it("defines Postgres lazily without opening a connection", () => {
    const database = defineDatabase({
      engine: "postgres",
      url: new SecretRef("BRICK_DEFINED_PG"),
    });
    expect(database.engine).toBe("postgres");
    expect(() => database.getDb()).toThrow("BRICK_DEFINED_PG");
  });
});

// Compile-time assertions: service and action inference must retain the schema.
function _typeAssertions() {
  const database = defineDatabase({ tables: { items } });
  const service = defineService("defined_types", { database });
  const typed: BunSQLiteDatabase<{ items: typeof items }> | undefined =
    service.getDb();
  service.action({
    name: "typed",
    execute: ({ ctx }) => {
      // @ts-expect-error Unknown tables must not become any.
      ctx.db.query.missing.findMany();
      return ctx.db.query.items.findMany();
    },
  });
  return typed;
}
