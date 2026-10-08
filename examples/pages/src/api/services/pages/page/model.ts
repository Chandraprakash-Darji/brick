import { boolean, pgTable, text } from "@brickkit/core/pg";

export type Theme = "github-dark" | "github-light" | "dracula" | "nord";
export type ContentType = "markdown" | "html";
export const THEMES = [
  "github-dark",
  "github-light",
  "dracula",
  "nord",
] as const;
export const CONTENT_TYPES = ["markdown", "html"] as const;

// Pure Drizzle table (the single source of truth).
export const pagesTable = pgTable("pages", {
  content: text("content").notNull(),
  contentType: text("content_type")
    .$type<ContentType>()
    .notNull()
    .default("markdown"),
  createdAt: text("created_at").notNull(),
  id: text("id").primaryKey(),
  isPublic: boolean("is_public").notNull().default(false),
  slug: text("slug").notNull().unique(),
  theme: text("theme").$type<Theme>().notNull().default("github-dark"),
  title: text("title").notNull(),
  updatedAt: text("updated_at").notNull(),
  userId: text("user_id"),
});

export type Page = typeof pagesTable.$inferSelect;

/** Page metadata without the content body (Go `pageMeta` parity). */
export type PageMeta = Omit<Page, "content">;

export function toPageMeta(row: Page): PageMeta {
  return {
    contentType: row.contentType,
    createdAt: row.createdAt,
    id: row.id,
    isPublic: row.isPublic,
    slug: row.slug,
    theme: row.theme,
    title: row.title,
    updatedAt: row.updatedAt,
    userId: row.userId,
  };
}
