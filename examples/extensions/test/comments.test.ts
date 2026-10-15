import { expect, test } from "bun:test";
import {
  defineDatabase,
  defineService,
  sqliteTable,
  syncSchema,
  text,
  ValidationError,
} from "@brickkit/core";
import { comments, commentsTable } from "../src/extensions/comments";

const pages = sqliteTable("pages", { id: text("id").primaryKey() });

test("comment creation rejects missing, null and blank bodies without inserting", async () => {
  const database = defineDatabase({ tables: { pages, commentsTable } });
  const db = database.getDb();
  syncSchema(database.tables, db);
  await db.insert(pages).values({ id: "page-1" });
  const page = defineService("comment_body_validation", { database })
    .resource({ name: "page", table: pages, id: pages.id })
    .use(comments({ table: commentsTable }));

  for (const input of [
    { targetId: "page-1" },
    { targetId: "page-1", body: undefined },
    { targetId: "page-1", body: null },
  ]) {
    // @ts-expect-error Exercise invalid inputs that can arrive from external callers.
    await expect(page.comments.create.run(input)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db.select().from(commentsTable)).toEqual([]);
  }

  for (const body of ["", "   ", "\n\t"]) {
    await expect(
      page.comments.create.run({ targetId: "page-1", body }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Comment body cannot be blank",
      status: 400,
    });
    expect(await db.select().from(commentsTable)).toEqual([]);
  }

  await page.comments.create.run({ targetId: "page-1", body: "  Hello  " });
  expect(
    await db.select({ body: commentsTable.body }).from(commentsTable),
  ).toEqual([{ body: "Hello" }]);
});
