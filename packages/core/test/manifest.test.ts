import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  defineDatabase,
  sqliteTable,
  text,
  integer,
  defineAction,
  emitManifest,
  emitManifestJson,
  mapColumnToManifestType,
  resetGlobalRegistry,
  t,
} from "../src";

const postsTable = sqliteTable("posts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  views: integer("views").notNull().default(0),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  authorId: text("author_id"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: text("created_at").notNull(),
});

describe("BrickManifestV1 Emission (@elregaldo/core)", () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  it("maps Drizzle column types accurately to ManifestFieldTypeV1", () => {
    expect(mapColumnToManifestType({ dataType: "string", columnType: "SQLiteText" })).toBe("string");
    expect(mapColumnToManifestType({ dataType: "number", columnType: "SQLiteInteger" })).toBe("integer");
    expect(mapColumnToManifestType({ dataType: "boolean", columnType: "SQLiteBoolean" })).toBe("boolean");
    expect(mapColumnToManifestType({ mode: "boolean", columnType: "SQLiteInteger" })).toBe("boolean");
    expect(mapColumnToManifestType({ dataType: "uuid", columnType: "PgUUID" })).toBe("uuid");
    expect(mapColumnToManifestType({ columnType: "PgUUID" })).toBe("uuid");
    expect(mapColumnToManifestType({ dataType: "date", columnType: "SQLiteTimestamp" })).toBe("timestamp");
    expect(mapColumnToManifestType({ mode: "timestamp", columnType: "SQLiteInteger" })).toBe("timestamp");
    expect(mapColumnToManifestType({ columnType: "PgTimestamp" })).toBe("timestamp");
  });

  it("defines service + table + resource + custom action → build() → emitManifest() → round-trip preserves semantics", async () => {
    const database = defineDatabase({ tables: [postsTable] });
    const blogService = defineService("blog", { database });

    // Resource with ownerField, searchable, sortable, operations
    blogService.resource({
      name: "post",
      table: postsTable,
      ownerField: "authorId",
      searchable: ["title", "slug"],
      sortable: ["title", "views", "createdAt"],
      operations: {
        list: true,
        get: true,
        create: true,
        update: true,
        delete: true,
      },
    });

    // Custom action
    blogService.action({
      name: "publishPost",
      input: t.Object({
        postId: t.String(),
      }),
      output: t.Object({
        published: t.Boolean(),
      }),
      execute: async () => {
        return { published: true };
      },
    });

    // Explicitly build service
    blogService.build();
    expect(blogService.isBuilt).toBe(true);

    // Emit manifest object and JSON
    const manifest = blogService.emitManifest();
    const jsonStr = blogService.emitManifestJson();

    // 1. Version check
    expect(manifest.version).toBe(1);
    expect(manifest.services.length).toBe(1);

    const svcManifest = manifest.services[0];
    expect(svcManifest.id).toBe("blog");
    expect(svcManifest.name).toBe("blog");

    // 2. Tables check: verify name vs dbName preservation, column types, nullability, PK
    expect(svcManifest.tables.length).toBe(1);
    const tableManifest = svcManifest.tables[0];
    expect(tableManifest.id).toBe("posts");
    expect(tableManifest.name).toBe("posts");

    const idField = tableManifest.fields.find((f) => f.name === "id");
    expect(idField).toEqual({
      name: "id",
      dbName: "id",
      type: "string",
      nullable: false,
      primaryKey: true,
    });

    const authorIdField = tableManifest.fields.find((f) => f.name === "authorId");
    expect(authorIdField).toEqual({
      name: "authorId",
      dbName: "author_id",
      type: "string",
      nullable: true,
      primaryKey: false,
    });

    const viewsField = tableManifest.fields.find((f) => f.name === "views");
    expect(viewsField).toEqual({
      name: "views",
      dbName: "views",
      type: "integer",
      nullable: false,
      primaryKey: false,
    });

    const publishedField = tableManifest.fields.find((f) => f.name === "published");
    expect(publishedField).toEqual({
      name: "published",
      dbName: "published",
      type: "boolean",
      nullable: false,
      primaryKey: false,
    });

    const publishedAtField = tableManifest.fields.find((f) => f.name === "publishedAt");
    expect(publishedAtField).toEqual({
      name: "publishedAt",
      dbName: "published_at",
      type: "timestamp",
      nullable: true,
      primaryKey: false,
    });

    // 3. Resources check: plan-derived metadata
    expect(svcManifest.resources.length).toBe(1);
    const resManifest = svcManifest.resources[0];
    expect(resManifest.id).toBe("post");
    expect(resManifest.name).toBe("post");
    expect(resManifest.table).toBe("posts");
    expect(resManifest.ownerField).toBe("authorId");
    expect(resManifest.searchable).toEqual(["title", "slug"]);
    expect(new Set(resManifest.sortable)).toEqual(new Set(["title", "views", "createdAt"]));
    expect(resManifest.operations).toEqual(["list", "get", "create", "update", "delete"]);

    // 4. Actions check: deduplicated aliases, execution typescript
    const actionIds = svcManifest.actions.map((a) => a.id);
    expect(actionIds).toContain("publishPost");
    expect(actionIds).toContain("post.create");
    expect(actionIds).toContain("post.get");
    expect(actionIds).toContain("post.list");
    expect(actionIds).toContain("post.update");
    expect(actionIds).toContain("post.delete");

    // Ensure aliases like "createPost" or "getPost" did not create duplicate entries
    const uniqueIds = new Set(actionIds);
    expect(actionIds.length).toBe(uniqueIds.size);

    for (const act of svcManifest.actions) {
      expect(act.execution).toBe("typescript");
    }

    // 5. Must not contain functions, schemas, or db handles
    for (const key of Object.keys(manifest)) {
      expect(["version", "services"]).toContain(key);
    }

    // 6. JSON round-trip preserves exact semantics
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toEqual(manifest);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);

    // 7. Standalone helper function works and matches
    const helperManifest = emitManifest(blogService);
    expect(helperManifest).toEqual(manifest);

    const helperJson = emitManifestJson(blogService);
    expect(helperJson).toBe(jsonStr);

    // 8. Snapshot golden file
    expect(manifest).toMatchSnapshot();
  });
});
