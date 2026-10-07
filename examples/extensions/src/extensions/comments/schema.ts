import { sqliteTable, text } from "@elregaldo/core";

export const commentsTable = sqliteTable("comments", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull(),
  body: text("body").notNull(),
});
