import { t, eq, and } from "@brickkit/core";

import { pagesService, pagesTable } from "../service";
import { requireUser, ownerId } from "./_shared";

export const getPageContentTool = pagesService.action({
  authorize: requireUser,
  description:
    "Get the raw source content of a page. Returns the original markdown or HTML source as a plain text string — NOT rendered. Use render_page to get a previewable HTML document. The returned content can be used with tools that write files (like VS Code's filesystem tools) for local editing before uploading back.",
  execute: async ({ input, ctx, error }) => {
    const userId = ownerId(ctx);
    const [page] = await ctx.db
      .select({
        content: pagesTable.content,
        contentType: pagesTable.contentType,
        id: pagesTable.id,
        title: pagesTable.title,
      })
      .from(pagesTable)
      .where(and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)))
      .limit(1);
    if (!page) {
      error.NOT_FOUND("page not found or not owned by you");
    }
    return page.content;
  },
  input: t.Object({ id: t.String() }, { additionalProperties: false }),
  name: "get_page_content",
  output: t.String(),
});
