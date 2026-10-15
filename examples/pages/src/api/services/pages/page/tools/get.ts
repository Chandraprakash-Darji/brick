import { Effect } from "effect";
import { t, eq, and } from "@brickkit/core";

import { pagesService, pagesTable } from "../service";
import {
  PageMetaSchema,
  pageMetaProjection,
  requireUser,
  ownerId,
} from "./_shared";

export const getPageTool = pagesService.tool({
  annotations: { readOnlyHint: true },
  title: "View Page",
  authorize: requireUser,
  description:
    "Get a single page's metadata (id, title, slug, contentType, theme, isPublic, createdAt, updatedAt). Does NOT include the page body — use get_page_content or render_page for that.",
  execute: ({ input, ctx, error }) =>
    Effect.tryPromise({
      try: async () => {
        const userId = ownerId(ctx);
        const [page] = await ctx.db
          .select(pageMetaProjection)
          .from(pagesTable)
          .where(
            and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)),
          )
          .limit(1);
        if (!page) {
          error.NOT_FOUND("page not found or not owned by you");
        }
        return page;
      },
      catch: (failure) => failure,
    }),
  input: t.Object({ id: t.String() }, { additionalProperties: false }),
  name: "get_page",
  output: PageMetaSchema,
});
