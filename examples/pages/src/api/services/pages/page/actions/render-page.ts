import { t, eq, and } from "@brickkit/core";

import { renderContent } from "../render";
import { pagesService, pagesTable } from "../service";
import { requireUser, ownerId } from "./_shared";

export const renderPageTool = pagesService.action({
  authorize: requireUser,
  description:
    "Render a page to a complete, self-contained HTML document. The returned HTML inlines all theme CSS so it renders correctly without external resources. Save this output to a .html file locally to preview how the page will look when published. Supports GitHub-Flavored Markdown (tables, strikethrough, task lists, auto-heading IDs), Mermaid diagrams, and auto-generated table of contents.",
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
    return renderContent(
      page.title,
      page.content,
      page.contentType,
      page.theme,
    );
  },
  input: t.Object({ id: t.String() }, { additionalProperties: false }),
  name: "render_page",
  output: t.String(),
});
