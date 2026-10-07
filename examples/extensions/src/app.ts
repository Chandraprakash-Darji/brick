import { defineDatabase, defineService, syncSchema } from "@brickkit/core";
import { createBrickServer } from "@brickkit/cli";
import { commentsTable, registerComments } from "./extensions/comments";

const database = defineDatabase({ tables: { comments: commentsTable } });
syncSchema(database.tables, database.getDb());

export const pagesService = defineService("pages", { database });
export const commentsExtension = registerComments(pagesService);
export const app = createBrickServer({ services: [pagesService], requestLogging: false });
