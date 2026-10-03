import { describe, it, expect, beforeEach } from "bun:test";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import {
  defineService,
  defineAction,
  createDatabase,
  attachDatabase,
  resetGlobalRegistry,
  t,
  eq,
} from "../src";

// Define a test table
export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  age: integer("age"),
});

describe("@brick-ts/core Database & Drizzle Integration", () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  it("should create an in-memory SQLite database with Drizzle ORM", async () => {
    const db = createDatabase({ engine: "sqlite", path: ":memory:" });
    expect(db).toBeDefined();

    // Create table directly
    db.run(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, age INTEGER);"
    );

    // Insert using Drizzle ORM
    await db.insert(usersTable).values({
      id: "u_1",
      name: "Alice",
      email: "alice@example.com",
      age: 28,
    });

    // Query back using Drizzle ORM
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, "u_1"));
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe(28);
  });

  it("should attach database to a service and use ctx.db in actions", async () => {
    const usersService = defineService("users", { database: true });
    const db = attachDatabase(usersService, { engine: "sqlite", path: ":memory:" });

    db.run(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, age INTEGER);"
    );

    const createUser = defineAction({
      name: "createUser",
      input: t.Object({
        name: t.String(),
        email: t.String(),
        age: t.Optional(t.Number()),
      }),
      output: t.Object({
        id: t.String(),
        name: t.String(),
        email: t.String(),
        age: t.Optional(t.Number()),
      }),
      execute: async ({ input, ctx }) => {
        expect(ctx.db).toBeDefined();
        const id = `u_${Date.now()}`;
        await ctx.db.insert(usersTable).values({
          id,
          name: input.name,
          email: input.email,
          age: input.age,
        });

        return {
          id,
          name: input.name,
          email: input.email,
          age: input.age,
        };
      },
    });

    usersService.action(createUser);

    const result = await createUser.run(
      {
        name: "Bob",
        email: "bob@brick.dev",
        age: 30,
      },
      { db: usersService.getDb() }
    );

    expect(result.name).toBe("Bob");

    // Verify stored record via Drizzle
    const stored = await db.select().from(usersTable).where(eq(usersTable.id, result.id));
    expect(stored.length).toBe(1);
    expect(stored[0].email).toBe("bob@brick.dev");
  });
});
