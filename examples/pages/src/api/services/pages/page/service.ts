import { Effect } from "effect";
import { crud } from "@brickkit/crud/effect";
import { ActionExecutionError, eq } from "@brickkit/core";
import { defineService } from "@brickkit/core/effect";

import { getAuth } from "../../../auth";
import { appDb } from "../../../db";
import { pagesTable } from "./model";

export * from "./model";

// 2. Define Service with the shared Postgres database + better-auth session loading.
// The context resolver runs once per request: it reads the session cookie
// (or bearer token) via better-auth and injects user/session for all actions.
export const pagesService = defineService("pages", {
  context: ({ request }) =>
    Effect.tryPromise({
      try: async () => {
        const session = await getAuth().api.getSession({
          headers: request.headers,
        });
        return {
          session: session?.session ?? null,
          user: session?.user ?? null,
        };
      },
      catch: (failure) => failure,
    }),
  database: appDb,
});

export const pagesResource = pagesService
  .resource({
    name: "page",
    table: pagesTable,
    id: pagesTable.id,
  })
  .use(
    crud({
      fields: {
        id: { read: true, filter: ["eq", "in"] },
        slug: {
          read: true,
          create: true,
          update: true,
          filter: ["eq", "contains"],
          sort: true,
        },
        title: {
          read: true,
          create: true,
          update: true,
          filter: ["eq", "contains"],
          sort: true,
        },
        content: { read: true, create: true, update: true },
        contentType: { read: true, create: true, update: true },
        theme: { read: true, create: true, update: true },
        isPublic: { read: true, create: true, update: true, filter: ["eq"] },
        userId: { read: true },
        createdAt: { read: true, sort: true },
        updatedAt: { read: true, sort: true },
      },
      defaultLimit: 20,
      maxLimit: 100,
      access: {
        authorize: ({ ctx }) =>
          Effect.succeed(!!(ctx as { user?: { id?: string } | null }).user?.id),
        scope: ({ operation, ctx }) =>
          Effect.succeed(
            operation === "create"
              ? undefined
              : eq(
                  pagesTable.userId,
                  (ctx as { user: { id: string } }).user.id,
                ),
          ),
      },
      hooks: {
        beforeCreate: ({ data, ctx }) =>
          Effect.gen(function* () {
            const exists = yield* Effect.tryPromise({
              try: () =>
                ctx.db
                  .select()
                  .from(pagesTable)
                  .where(eq(pagesTable.slug, String(data.slug))) as Promise<
                  Array<typeof pagesTable.$inferSelect>
                >,
              catch: (failure) => failure,
            });
            if (exists.length)
              return yield* Effect.fail(
                new ActionExecutionError(
                  "CONFLICT",
                  `Slug '${data.slug}' is already taken`,
                  409,
                ),
              );
            data.id = crypto.randomUUID();
            data.userId = (ctx as { user: { id: string } }).user.id;
            data.createdAt = data.updatedAt = new Date().toISOString();
          }),
        beforeUpdate: ({ data }) =>
          Effect.sync(() => {
            data.updatedAt = new Date().toISOString();
          }),
      },
    }),
  );
