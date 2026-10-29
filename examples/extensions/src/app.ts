import {
  brick,
  defineDatabase,
  defineService,
  syncSchema,
  sqliteTable,
  text,
} from "@brickkit/core";
import { crud } from "@brickkit/crud";
import { comments } from "./extensions/comments";

const pages = sqliteTable("pages", { id: text("id").primaryKey() });
const database = defineDatabase({ tables: { pages } });
export const pagesService = defineService("pages", { database });
export const page = pagesService
  .resource({ name: "page", table: pages, id: pages.id })
  .use(crud({ access: "public", fields: { id: { read: true, create: true } } }))
  .use(comments({ maxLength: 500 }));

// The plugin added its table (page_comments) to the database: sync creates it.
syncSchema(pagesService);
await database
  .getDb()
  .insert(pages)
  .values([{ id: "page-1" }, { id: "page-2" }]);
export const app = brick({ services: [pagesService], requestLogging: false });
