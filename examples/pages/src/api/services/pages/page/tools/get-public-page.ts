import { t, eq, and } from "@brickkit/core";

import { pagesService, pagesTable } from "../service";
import { PageMetaSchema } from "./_shared";

export const getPublicPageTool = pagesService.tool({
  annotations: { readOnlyHint: true },
  title: "View Public Page",
  http: true,
  description:
    "Get a public page by its slug. No authentication required. Returns page metadata (id, title, slug, contentType, theme, isPublic, createdAt, updatedAt). Only works for pages with isPublic=true. For private pages, the authenticated user must use get_page instead.",
  execute: async ({ input, ctx, error }) => {
    const [page] = await ctx.db
      .select({
        contentType: pagesTable.contentType,
        createdAt: pagesTable.createdAt,
        id: pagesTable.id,
        isPublic: pagesTable.isPublic,
        slug: pagesTable.slug,
        theme: pagesTable.theme,
        title: pagesTable.title,
        updatedAt: pagesTable.updatedAt,
      })
      .from(pagesTable)
      .where(
        and(eq(pagesTable.slug, input.slug), eq(pagesTable.isPublic, true)),
      )
      .limit(1);
    if (!page) {
      error.NOT_FOUND("public page not found");
    }
    return page;
  },
  input: t.Object({ slug: t.String() }, { additionalProperties: false }),
  method: "GET",
  name: "get_public_page",
  output: PageMetaSchema,
  path: "/api/public/pages/:slug",
});
