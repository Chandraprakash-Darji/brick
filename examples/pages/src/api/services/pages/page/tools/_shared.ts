import { t } from "@brickkit/core";

import { pagesTable } from "../service";

export const ThemeSchema = t.Union([
  t.Literal("github-dark"),
  t.Literal("github-light"),
  t.Literal("dracula"),
  t.Literal("nord"),
]);

export const ContentTypeSchema = t.Union([
  t.Literal("markdown"),
  t.Literal("html"),
]);

/** Page metadata without the content body (Go `pageMeta` parity). */
export const PageMetaSchema = t.Object({
  contentType: ContentTypeSchema,
  createdAt: t.String(),
  id: t.String(),
  isPublic: t.Boolean(),
  slug: t.String(),
  theme: ThemeSchema,
  title: t.String(),
  updatedAt: t.String(),
  userId: t.Optional(t.Union([t.String(), t.Null()])),
});

/** Metadata projection: list/detail responses never include the body. */
export const pageMetaProjection = {
  contentType: pagesTable.contentType,
  createdAt: pagesTable.createdAt,
  id: pagesTable.id,
  isPublic: pagesTable.isPublic,
  slug: pagesTable.slug,
  theme: pagesTable.theme,
  title: pagesTable.title,
  updatedAt: pagesTable.updatedAt,
  userId: pagesTable.userId,
};

export const requireUser = ({ user }: { user?: { id?: string } | null }) =>
  !!user?.id;

export function ownerId(ctx: any): string {
  const id: string | undefined = ctx?.user?.id;
  if (!id) throw new Error("Unauthorized: Active session required");
  return id;
}
