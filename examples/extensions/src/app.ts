import {
  defineDatabase,
  defineService,
  syncSchema,
  sqliteTable,
  text,
} from "@brickkit/core";
import { brick } from "@brickkit/core";
import { commentsTable, comments } from "./extensions/comments";
const pages = sqliteTable("pages", { id: text("id").primaryKey() });
const database = defineDatabase({ tables: { pages, comments: commentsTable } });
syncSchema(database.tables, database.getDb());
await database
  .getDb()
  .insert(pages)
  .values([{ id: "page-1" }, { id: "page-2" }]);
export const pagesService = defineService("pages", { database });
export const page = pagesService
  .resource({ name: "page", table: pages, id: pages.id })
  .use(comments({ table: commentsTable }));
export const app = brick({ services: [pagesService], requestLogging: false });
