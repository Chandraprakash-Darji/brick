import {
  defineService,
  t,
  defineDatabase,
  syncSchema,
  sqliteTable,
  text,
} from "@brickkit/core";
const service = defineService("built", {
  context: (ctx) => ({
    user: ctx.request.headers.get("x-user") ? { id: "alice" } : null,
  }),
});
service.action({
  name: "getPage",
  method: "GET",
  path: "/api/public/pages/:slug",
  input: t.Object({ slug: t.String({ minLength: 2 }) }),
  output: t.Object({ slug: t.String() }),
  authorize: ({ user }) => Boolean(user),
  execute: async ({ input }) => input,
});
const plain = defineService("plain");
plain.action({
  name: "getReady",
  method: "GET",
  execute: () => ({ ok: true }),
});

const pages = sqliteTable("built_read_pages", {
  id: text("page_id").primaryKey(),
  title: text("headline").notNull(),
});
const database = defineDatabase({ tables: [pages] });
syncSchema(database.tables, database.getDb());
database.getDb().insert(pages).values({ id: "one", title: "Built page" }).run();
const store = defineService("store", { database });
store.resource({ name: "page", table: pages, defaultSort: "id" });
