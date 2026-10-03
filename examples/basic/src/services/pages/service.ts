import {
  defineService,
  defineDatabase,
  sqliteTable,
  text,
  integer,
  eq,
  and,
  t,
} from "@brick/core";

export type Theme = "github-dark" | "github-light" | "dracula" | "nord";
export type ContentType = "markdown" | "html";
export const THEMES = ["github-dark", "github-light", "dracula", "nord"] as const;
export const CONTENT_TYPES = ["markdown", "html"] as const;

// 1. Define pure Drizzle table (The single source of truth)
export const pagesTable = sqliteTable("pages", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  contentType: text("content_type").$type<ContentType>().notNull().default("markdown"),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  theme: text("theme").$type<Theme>().notNull().default("github-dark"),
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Page = typeof pagesTable.$inferSelect;

// 2. Define Service with SQLite database
export const pagesDb = defineDatabase({
  path: process.env.DB_PATH ?? "./data/pages.db",
  tables: { pagesTable },
});
export const pagesService = defineService("pages", {
  database: pagesDb,
});

// 3. Attach Resource at Service Level (Automatic CRUD & Schema Registration)
export const pagesResource = pagesService.resource({
  name: "page",
  table: pagesTable,
  ownerField: "userId",
  operations: {
    list: { defaultLimit: 20, maxLimit: 100 },
    get: true,
    create: true,
    update: true,
    delete: true,
  },
  hooks: {
    beforeCreate: async ({ data, ctx, error }) => {
      // Validate unique slug before writing
      const exists = await ctx.db
        .select()
        .from(pagesTable)
        .where(eq(pagesTable.slug, data.slug));
      if (exists.length > 0) {
        error.CONFLICT(`Slug '${data.slug}' is already taken`);
      }
    },
  },
});

// Export CRUD actions generated automatically by resource
export const {
  create: createPage,
  get: getPage,
  list: listPages,
  update: updatePage,
  delete: deletePage,
} = pagesResource.actions;

// TypeBox Page Schema for external references
export const PageSchema = t.Object({
  id: t.String(),
  slug: t.String(),
  title: t.String(),
  content: t.String(),
  contentType: t.Union([t.Literal("markdown"), t.Literal("html")]),
  isPublic: t.Boolean(),
  theme: t.Union([
    t.Literal("github-dark"),
    t.Literal("github-light"),
    t.Literal("dracula"),
    t.Literal("nord"),
  ]),
  userId: t.Optional(t.Union([t.String(), t.Null()])),
  createdAt: t.String(),
  updatedAt: t.String(),
});

// Helper: Extract TOC Headings from Markdown
export function extractHeadings(markdown: string) {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const headings: Array<{ level: number; id: string; text: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    headings.push({ level, id, text });
  }

  return headings;
}

// 4. Custom public reader action (no auth / no owner filtering)
export const getPublicPage = pagesService.action({
  name: "getPublicPage",
  description: "Get a published page by slug (public reading surface)",
  path: "/api/public/pages/:slug",
  input: t.Object({ slug: t.String() }),
  execute: async ({ input, ctx, error }): Promise<Page> => {
    const [page] = await ctx.db
      .select()
      .from(pagesTable)
      .where(and(eq(pagesTable.slug, input.slug), eq(pagesTable.isPublic, true)));

    if (!page) {
      error.NOT_FOUND(`Published page '/${input.slug}' not found or is private`);
    }

    return page;
  },
});

// 5. Custom render action with TOC extraction
export const renderPage = pagesService.action({
  name: "renderPage",
  description: "Render markdown document with Table of Contents and theme styling",
  input: t.Object({
    slug: t.String(),
  }),
  output: t.Object({
    slug: t.String(),
    title: t.String(),
    content: t.String(),
    theme: t.String(),
    toc: t.Array(
      t.Object({
        level: t.Number(),
        id: t.String(),
        text: t.String(),
      })
    ),
  }),
  execute: async ({ input, ctx, error }) => {
    const [page] = await ctx.db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.slug, input.slug));

    if (!page) {
      error.NOT_FOUND(`Page '${input.slug}' not found`);
    }

    const toc = extractHeadings(page.content);

    return {
      slug: page.slug,
      title: page.title,
      content: page.content,
      theme: page.theme,
      toc,
    };
  },
});
