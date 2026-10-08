import { describe, expect, it } from "bun:test";
import {
  defineDatabase,
  defineResource,
  defineService,
  sqliteTable,
  text,
  integer,
  syncSchema,
  t,
} from "../src";
import {
  createBrickClient,
  defineAppContract,
  type InferActionInput,
} from "../src/client";

const rows = sqliteTable("resource_type_rows", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  note: text("note"),
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

function makeResource() {
  const database = defineDatabase({ tables: { rows } });
  const service = defineService("resource_types", { database });
  const resource = service.resource({
    name: "row",
    table: rows,
    ownerField: "userId",
    hooks: {
      beforeCreate: ({ data }) => {
        const title: string = data.title;
        // @ts-expect-error Hooks must retain the table shape too.
        void data.missing;
        void title;
      },
    },
  });
  return { database, service, resource };
}

describe("resource action types", () => {
  it("matches the generated schemas and projected list rows", async () => {
    const { database, resource } = makeResource();
    syncSchema(database.tables, database.getDb());
    const created = await resource.create({
      input: { title: "Typed", content: "Body" },
      ctx: { user: { id: "owner" } },
    });
    expect(created.userId).toBe("owner");
    expect(created.status).toBe("draft");
    const listed = await resource.list({ input: {} });
    expect(listed.items[0]?.id).toBe(created.id);
    expect(listed.items[0]?.content).toBeUndefined();
    expect(
      resource.create.validateInput({
        title: "Typed",
        content: "Body",
        note: null,
      }).success,
    ).toBe(false);
  });
});

type IsAny<T> = 0 extends 1 & T ? true : false;

function _typeAssertions() {
  const { resource, service } = makeResource();
  const contract = defineAppContract({ row: resource });
  const api = createBrickClient<typeof contract>({
    baseUrl: "http://localhost:4000",
  });
  const inputIsAny: IsAny<InferActionInput<typeof resource.create>> = false;
  const outputIsAny: IsAny<Awaited<ReturnType<typeof api.row.create>>> = false;
  api.row.create({ title: "Typed", content: "Body" });
  api.row.create({
    title: "Typed",
    content: "Body",
    status: "published",
    note: "optional",
  });
  const row: Promise<typeof rows.$inferSelect> = api.row.get({ id: "row_1" });
  const created: Promise<typeof rows.$inferSelect> = api.row.create({
    title: "Typed",
    content: "Body",
  });
  // @ts-expect-error Required create input must not be optional.
  api.row.create();
  // @ts-expect-error Required table fields must be retained.
  api.row.create({ title: "Typed" });
  // @ts-expect-error Column value types must be retained.
  api.row.create({ title: 123, content: "Body" });
  // @ts-expect-error Enum values must be retained.
  api.row.create({ title: "Typed", content: "Body", status: "other" });
  // @ts-expect-error Owner fields are supplied by context.
  api.row.create({ title: "Typed", content: "Body", userId: "forged" });
  // @ts-expect-error IDs are generated.
  api.row.create({ title: "Typed", content: "Body", id: "forged" });
  // @ts-expect-error Timestamps are generated.
  api.row.create({ title: "Typed", content: "Body", createdAt: "forged" });
  // @ts-expect-error Nullable columns use optional non-null create inputs at runtime.
  api.row.create({ title: "Typed", content: "Body", note: null });
  api.row.update({ id: "row_1", title: "Updated" });
  // @ts-expect-error Updates require the ID.
  api.row.update({ title: "Updated" });
  // @ts-expect-error Gets require an ID.
  api.row.get({});
  // @ts-expect-error Deletes require an ID.
  api.row.delete();
  api.row.list();
  api.row.list({ limit: 10, status: "draft", select: ["id", "title"] });
  // @ts-expect-error Query filters retain their column type.
  api.row.list({ status: 123 });
  // @ts-expect-error List rows may omit columns through projection.
  const fullRows: Promise<{ items: (typeof rows.$inferSelect)[] }> =
    api.row.list();

  const custom = sqliteTable("resource_custom_keys", {
    key: text("record_key").primaryKey(),
    owner: text("owner_id"),
    title: text("title").notNull(),
    priority: integer("priority").notNull().default(1),
    created: text("created_at").notNull(),
  });
  const customResource = defineResource(service, {
    name: "custom",
    table: custom,
    idField: "key",
    ownerField: "owner_id",
    fields: { priority: t.Union([t.Literal(1), t.Literal(2)]) },
  });
  const customApi = createBrickClient<{ custom: typeof customResource }>({
    baseUrl: "http://localhost:4000",
  });
  customApi.custom.create({ title: "Typed", priority: 2 });
  customApi.custom.get({ key: "custom_1" });
  // @ts-expect-error Field overrides must affect the SDK input.
  customApi.custom.create({ title: "Typed", priority: 3 });
  // @ts-expect-error Owner database-name aliases must be excluded.
  customApi.custom.create({ title: "Typed", owner: "forged" });
  // @ts-expect-error Timestamps are identified by database names too.
  customApi.custom.create({ title: "Typed", created: "forged" });
  // @ts-expect-error Custom idField must be preserved.
  customApi.custom.get({ id: "custom_1" });
  return { inputIsAny, outputIsAny, row, created, fullRows };
}
