import { t, eq } from "@brickkit/core";

import { pagesService, pagesTable, toPageMeta } from "../service";
import {
  ThemeSchema,
  ContentTypeSchema,
  PageMetaSchema,
  requireUser,
  ownerId,
} from "./_shared";

export const createPageTool = pagesService.action({
  authorize: requireUser,
  description:
    "Create a new page with metadata (title, slug, contentType, theme, isPublic). The page is created with empty content — use upload_content to set the body after optionally previewing the rendered HTML with render_page. The slug must be unique across all pages.",
  execute: async ({ input, ctx, error }) => {
    const userId = ownerId(ctx);
    const contentType = input.contentType ?? "markdown";
    const theme = input.theme ?? "github-dark";
    const isPublic = input.isPublic ?? false;

    const [existing] = await ctx.db
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(eq(pagesTable.slug, input.slug))
      .limit(1);
    if (existing) {
      error.CONFLICT(`Slug '${input.slug}' is already taken`);
    }

    const now = new Date().toISOString();
    const id = `pg_${Math.random().toString(36).substring(2, 10)}`;
    await ctx.db.insert(pagesTable).values({
      content: "",
      contentType,
      createdAt: now,
      id,
      isPublic,
      slug: input.slug,
      theme,
      title: input.title,
      updatedAt: now,
      userId,
    });
    const [created] = await ctx.db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, id))
      .limit(1);
    return toPageMeta(created);
  },
  input: t.Object(
    {
      contentType: t.Optional(ContentTypeSchema),
      isPublic: t.Optional(t.Boolean()),
      slug: t.String({ pattern: "^[a-z0-9-]+$" }),
      theme: t.Optional(ThemeSchema),
      title: t.String({ maxLength: 500, minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  name: "create_page",
  output: PageMetaSchema,
});
