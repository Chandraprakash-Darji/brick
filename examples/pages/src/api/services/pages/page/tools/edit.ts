import { t, eq, and } from "@brickkit/core";

import { pagesService, pagesTable, toPageMeta } from "../service";
import {
  ThemeSchema,
  ContentTypeSchema,
  PageMetaSchema,
  requireUser,
  ownerId,
} from "./_shared";

export const editPageTool = pagesService.tool({
  title: "Edit Page",
  authorize: requireUser,
  description:
    "Edit page metadata (title, slug, theme, isPublic, contentType). Only the fields you provide will be updated — missing fields keep their current values. Does NOT touch the page content body — use upload_content for that.",
  execute: async ({ input, ctx, error }) => {
    const userId = ownerId(ctx);
    const [page] = await ctx.db
      .select()
      .from(pagesTable)
      .where(and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)))
      .limit(1);
    if (!page) {
      error.NOT_FOUND("page not found or not owned by you");
    }

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch["title"] = input.title;
    if (input.slug !== undefined) patch["slug"] = input.slug;
    if (input.contentType !== undefined)
      patch["contentType"] = input.contentType;
    if (input.theme !== undefined) patch["theme"] = input.theme;
    if (input.isPublic !== undefined) patch["isPublic"] = input.isPublic;

    if (patch["slug"] !== undefined && patch["slug"] !== page.slug) {
      const [taken] = await ctx.db
        .select({ id: pagesTable.id })
        .from(pagesTable)
        .where(eq(pagesTable.slug, patch["slug"] as string))
        .limit(1);
      if (taken && taken.id !== page.id) {
        error.CONFLICT(`Slug '${patch["slug"]}' is already taken`);
      }
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db
        .update(pagesTable)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)));
      const [updated] = await ctx.db
        .select()
        .from(pagesTable)
        .where(and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)))
        .limit(1);
      return toPageMeta(updated);
    }
    return toPageMeta(page);
  },
  input: t.Object(
    {
      contentType: t.Optional(ContentTypeSchema),
      id: t.String(),
      isPublic: t.Optional(t.Boolean()),
      slug: t.Optional(t.String({ pattern: "^[a-z0-9-]+$" })),
      theme: t.Optional(ThemeSchema),
      title: t.Optional(t.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
  name: "edit_page",
  output: PageMetaSchema,
});
