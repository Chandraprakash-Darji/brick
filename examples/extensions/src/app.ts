import { defineDatabase, defineService, syncSchema } from "@elregaldo/core";
import { createBrickServer } from "@elregaldo/cli";
import { commentsTable, registerComments } from "./extensions/comments";

const database = defineDatabase({ tables: { comments: commentsTable } });
syncSchema(database.tables, database.getDb());

export const pagesService = defineService("pages", { database });
export const commentsExtension = registerComments(pagesService);
export const app = createBrickServer({ services: [pagesService], requestLogging: false });
