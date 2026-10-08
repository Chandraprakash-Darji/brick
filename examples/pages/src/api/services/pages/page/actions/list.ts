import { t, eq, desc } from "@brickkit/core";

import { pagesService, pagesTable } from "../service";
import {
  PageMetaSchema,
  pageMetaProjection,
  requireUser,
  ownerId,
} from "./_shared";

export const listPagesTool = pagesService.action({
  authorize: requireUser,
  description:
    "List all pages owned by the authenticated user. Returns an array of page metadata objects with id, title, slug, contentType, theme, isPublic, userId, createdAt, and updatedAt. **No content body is included.**",
  execute: async ({ ctx }) => {
    const userId = ownerId(ctx);
    return ctx.db
      .select(pageMetaProjection)
      .from(pagesTable)
      .where(eq(pagesTable.userId, userId))
      .orderBy(desc(pagesTable.updatedAt));
  },
  input: t.Object({}, { additionalProperties: false }),
  name: "list_pages",
  output: t.Array(PageMetaSchema),
});
