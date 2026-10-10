import { sqliteTable, text } from "@brickkit/core";

export const commentsTable = sqliteTable("comments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  targetId: text("target_id").notNull(),
  body: text("body").notNull(),
});
