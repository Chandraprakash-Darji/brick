import { t, eq, and } from "@brickkit/core";

import { pagesService, pagesTable } from "../service";
import { requireUser, ownerId } from "./_shared";

export const deletePageTool = pagesService.action({
  authorize: requireUser,
  description:
    "Permanently delete a page and all its content by ID. This action cannot be undone. The page must be owned by the authenticated user.",
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
      .delete(pagesTable)
      .where(and(eq(pagesTable.id, input.id), eq(pagesTable.userId, userId)));
    return `Page ${input.id} deleted.`;
  },
  input: t.Object({ id: t.String() }, { additionalProperties: false }),
  name: "delete_page",
  output: t.String(),
});
