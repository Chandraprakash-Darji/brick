import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  defineDatabase,
  syncSchema,
  sqliteTable,
  text,
  integer,
  eq,
} from "../src";

const articlesTable = sqliteTable("articles", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  authorId: text("author_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

describe("Service-Level Resources & User-Owned Schema (@brickkit/core)", () => {
  let articlesService: import("../src").Service;
  let articlesResource: any;

  beforeEach(() => {
    const database = defineDatabase({ tables: [articlesTable] });
    syncSchema(database.tables, database.getDb());
    articlesService = defineService("articles_svc", {
      database,
    });

    articlesResource = articlesService.resource({
      name: "article",
      table: articlesTable,
      ownerField: "authorId",
      operations: {
        list: { defaultLimit: 10, maxLimit: 50 },
        get: true,
        create: true,
        update: true,
        delete: true,
      },
      hooks: {
        beforeCreate: async ({ data, error }) => {
          if (data.title === "FORBIDDEN_WORD") {
            error.BAD_REQUEST("Title contains forbidden word");
          }
        },
      },
    });
  });

  it("should automatically sync schema without manual DDL and insert records", async () => {
    // When resource() is registered, table DDL is automatically synced
    const created = await articlesResource.create({
      input: {
        slug: "first-article",
        title: "First Article",
        content: "Hello world",
        published: true,
      },
      ctx: {
        user: { id: "user_alice" },
      },
    });

    expect(created.id).toBeDefined();
    expect(created.slug).toBe("first-article");
    expect(created.authorId).toBe("user_alice");
    expect(created.published).toBe(true);
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();

    // Verify it exists in database
    const db = articlesService.getDb() as any;
    const [fetched] = await db
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.id, created.id));
    expect(fetched).toBeDefined();
    expect(fetched.title).toBe("First Article");
  });

  it("should trigger beforeCreate lifecycle hook and throw typed error", async () => {
    expect(
      articlesResource.create({
        input: {
          slug: "bad-title",
          title: "FORBIDDEN_WORD",
          content: "Some content",
        },
      })
    ).rejects.toThrow("Title contains forbidden word");
  });

  it("should enforce ownership scoping on get, update, delete, and list", async () => {
    // 1. Create article as Alice
    const aliceArticle = await articlesResource.create({
      input: {
        slug: "alice-post",
        title: "Alice Post",
        content: "Alice Content",
      },
      ctx: {
        user: { id: "user_alice" },
      },
    });

    // 2. Create article as Bob
    const bobArticle = await articlesResource.create({
      input: {
        slug: "bob-post",
        title: "Bob Post",
        content: "Bob Content",
      },
      ctx: {
        user: { id: "user_bob" },
      },
    });

    // 3. List as Alice: should only see Alice's articles
    const aliceList = await articlesResource.list({
      input: {},
      ctx: {
        user: { id: "user_alice" },
      },
    });
    expect(aliceList.total).toBe(1);
    expect(aliceList.articles[0].slug).toBe("alice-post");

    // 4. Bob tries to get Alice's article: should be 403 FORBIDDEN
    expect(
      articlesResource.get({
        input: { id: aliceArticle.id },
        ctx: {
          user: { id: "user_bob" },
        },
      })
    ).rejects.toThrow("Access denied to article");

    // 5. Bob tries to update Alice's article: should be 403 FORBIDDEN
    expect(
      articlesResource.update({
        input: {
          id: aliceArticle.id,
          title: "Hacked by Bob",
        },
        ctx: {
          user: { id: "user_bob" },
        },
      })
    ).rejects.toThrow("Access denied to update article");

    // 6. Bob tries to delete Alice's article: should be 403 FORBIDDEN
    expect(
      articlesResource.delete({
        input: { id: aliceArticle.id },
        ctx: {
          user: { id: "user_bob" },
        },
      })
    ).rejects.toThrow("Access denied to delete article");

    // 7. Alice can update her own article
    const updated = await articlesResource.update({
      input: {
        id: aliceArticle.id,
        title: "Alice Updated Title",
      },
      ctx: {
        user: { id: "user_alice" },
      },
    });
    expect(updated.title).toBe("Alice Updated Title");

    // 8. Alice can delete her own article
    const deleted = await articlesResource.delete({
      input: { id: aliceArticle.id },
      ctx: {
        user: { id: "user_alice" },
      },
    });
    expect(deleted.success).toBe(true);
  });
});
