import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pages = sqliteTable("pages", { id: text("id").primaryKey() });
export const commentsTable = sqliteTable("comments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  targetId: text("target_id").notNull(),
  body: text("body").notNull(),
});
