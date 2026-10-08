import { t, eq, and } from "@brickkit/core";

import { pagesService, pagesTable } from "../service";
import { requireUser, ownerId } from "./_shared";

export const uploadContentTool = pagesService.action({
  authorize: requireUser,
  description:
    "Upload (or replace) the full content body of a page. The content is raw markdown or HTML source, NOT a rendered document. After uploading you can call render_page to verify it looks correct, or use get_page_content to read it back. Prefer writing the content to a file locally first and then uploading it here — this lets you keep a local copy and use render_page for preview before committing.",
  execute: async ({ input, ctx, error }) => {
    const userId = ownerId(ctx);
    const [page] = await ctx.db
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)))
      .limit(1);
    if (!page) {
      error.NOT_FOUND("page not found or not owned by you");
    }
    await ctx.db
      .update(pagesTable)
      .set({ content: input.content, updatedAt: new Date().toISOString() })
      .where(and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)));
    // NOTE: Go reports len(content) in bytes; UTF-16 length is used here.
    return `Content uploaded to page ${input.id} (${input.content.length} bytes).`;
  },
  input: t.Object(
    { content: t.String(), id: t.String() },
    { additionalProperties: false },
  ),
  name: "upload_content",
  output: t.String(),
});
