import { Cause, Effect } from "effect";
import { Brick } from "@brickkit/core";
import { eq, and, desc } from "drizzle-orm";
import { postgresStore } from "@brickkit/crud";
import {
  Unauthorized,
  NotFound,
  Conflict,
  InternalServerError,
} from "@brickkit/core/contracts";
import { pageContract, tools } from "../../../contract";
import { PagesDatabase } from "../../../db";
import { requireUser } from "../../../identity";
import { pagesTable, toPageMeta } from "./model";
import { renderPageDocument } from "./render";
export * from "./model";
const failure = () =>
  new InternalServerError({ message: "Database operation failed" });
const writeFailure = (error: unknown) => {
  let cause = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof cause !== "object" || cause === null) break;
    if ("code" in cause && cause.code === "23505")
      return new Conflict({ message: "Slug is already taken" });
    if (!("cause" in cause)) break;
    cause = Cause.isCause(cause.cause)
      ? Cause.squash(cause.cause)
      : cause.cause;
    if (typeof cause === "object" && cause !== null && "reason" in cause)
      cause = cause.reason;
  }
  return failure();
};
const ownedPage = (id: string) =>
  Effect.gen(function* () {
    const userId = yield* requireUser;
    const db = yield* PagesDatabase;
    const [page] = yield* db
      .select()
      .from(pagesTable)
      .where(and(eq(pagesTable.id, id), eq(pagesTable.userId, userId)))
      .limit(1)
      .pipe(Effect.mapError(failure));
    if (!page)
      return yield* Effect.fail(
        new NotFound({ message: "Page not found or not owned by you" }),
      );
    return page;
  });
const crudActions = pageContract.implement({
  store: postgresStore(pagesTable, PagesDatabase),
  access: {
    authorize: () =>
      requireUser.pipe(
        Effect.as(true),
        Effect.catchTag("InternalServerError", () =>
          Effect.fail(new Unauthorized({ message: "Session unavailable" })),
        ),
      ),
    scope: ({ operation }) =>
      operation === "create"
        ? Effect.succeed(undefined)
        : requireUser.pipe(
            Effect.map((id) => eq(pagesTable.userId, id)),
            Effect.catchTag("InternalServerError", () =>
              Effect.fail(new Unauthorized({ message: "Session unavailable" })),
            ),
          ),
  },
  hooks: {
    beforeCreate: ({ data }) =>
      requireUser.pipe(
        Effect.map((userId) => ({
          ...data,
          id: crypto.randomUUID(),
          userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
        Effect.catchTag("InternalServerError", () =>
          Effect.fail(new Unauthorized({ message: "Session unavailable" })),
        ),
      ),
    beforeUpdate: ({ data }) =>
      Effect.succeed({ ...data, updatedAt: new Date().toISOString() }),
  },
});
export const toolActions = {
  list_pages: tools.list_pages(() =>
    Effect.gen(function* () {
      const id = yield* requireUser;
      const db = yield* PagesDatabase;
      return (yield* db
        .select()
        .from(pagesTable)
        .where(eq(pagesTable.userId, id))
        .orderBy(desc(pagesTable.updatedAt))
        .pipe(Effect.mapError(failure))).map(toPageMeta);
    }),
  ),
  get_page: tools.get_page(({ id }) =>
    ownedPage(id).pipe(Effect.map(toPageMeta)),
  ),
  get_page_content: tools.get_page_content(({ id }) =>
    ownedPage(id).pipe(Effect.map((p) => p.content)),
  ),
  render_page: tools.render_page(({ id }) =>
    ownedPage(id).pipe(Effect.map(renderPageDocument)),
  ),
  create_page: tools.create_page((input) =>
    Effect.gen(function* () {
      const userId = yield* requireUser;
      const db = yield* PagesDatabase;
      const now = new Date().toISOString();
      const [page] = yield* db
        .insert(pagesTable)
        .values({
          ...input,
          id: crypto.randomUUID(),
          userId,
          content: "",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .pipe(Effect.mapError(writeFailure));
      if (!page) return yield* Effect.fail(failure());
      return toPageMeta(page);
    }),
  ),
  edit_page: tools.edit_page(({ id, ...data }) =>
    Effect.gen(function* () {
      yield* ownedPage(id);
      const userId = yield* requireUser;
      const db = yield* PagesDatabase;
      const [page] = yield* db
        .update(pagesTable)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(and(eq(pagesTable.id, id), eq(pagesTable.userId, userId)))
        .returning()
        .pipe(Effect.mapError(writeFailure));
      if (!page)
        return yield* Effect.fail(new NotFound({ message: "Page not found" }));
      return toPageMeta(page);
    }),
  ),
  upload_content: tools.upload_content(({ id, content }) =>
    Effect.gen(function* () {
      yield* ownedPage(id);
      const userId = yield* requireUser;
      const db = yield* PagesDatabase;
      yield* db
        .update(pagesTable)
        .set({ content, updatedAt: new Date().toISOString() })
        .where(and(eq(pagesTable.id, id), eq(pagesTable.userId, userId)))
        .pipe(Effect.mapError(failure));
      return `Content uploaded to page ${id} (${new TextEncoder().encode(content).length} bytes).`;
    }),
  ),
  delete_page: tools.delete_page(({ id }) =>
    Effect.gen(function* () {
      yield* ownedPage(id);
      const userId = yield* requireUser;
      const db = yield* PagesDatabase;
      yield* db
        .delete(pagesTable)
        .where(and(eq(pagesTable.id, id), eq(pagesTable.userId, userId)))
        .pipe(Effect.mapError(failure));
      return `Page ${id} deleted.`;
    }),
  ),
  get_public_page: tools.get_public_page(({ slug }) =>
    Effect.gen(function* () {
      const db = yield* PagesDatabase;
      const [page] = yield* db
        .select()
        .from(pagesTable)
        .where(and(eq(pagesTable.slug, slug), eq(pagesTable.isPublic, true)))
        .limit(1)
        .pipe(Effect.mapError(failure));
      if (!page)
        return yield* Effect.fail(
          new NotFound({ message: "Public page not found" }),
        );
      return toPageMeta(page);
    }),
  ),
  echo: tools.echo(({ message }) =>
    requireUser.pipe(Effect.map((id) => `Echo: ${message} (for user ${id})`)),
  ),
  whoami: tools.whoami(() =>
    requireUser.pipe(Effect.map((id) => `You are authenticated as ${id}`)),
  ),
};
export const pagesService = Brick.service("pages", {
  actions: { ...crudActions, ...toolActions },
});
