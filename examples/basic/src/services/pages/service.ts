import {
  defineService,
  defineAction,
  t,
  sqliteTable,
  text,
  integer,
  eq,
  and,
  sql,
} from "@brick-ts/core";

export type Theme = "github-dark" | "github-light" | "dracula" | "nord";
export type ContentType = "markdown" | "html";

// 1. Drizzle SQLite schema for Pages (matching ../pages/server/dsl/page.resource.yaml)
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

// 2. Allowed Themes and Content Types from ../pages specification
export const THEMES = ["github-dark", "github-light", "dracula", "nord"] as const;
export const CONTENT_TYPES = ["markdown", "html"] as const;

// 3. Define the 'pages' service with persistent SQLite backing
export const pagesService = defineService("pages", {
  database: true,
});

// Helper to ensure tables exist
export function initPagesDatabase() {
  const db = pagesService.getDb();
  if (db) {
    db.run(sql`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'markdown',
        is_public INTEGER NOT NULL DEFAULT 0,
        theme TEXT NOT NULL DEFAULT 'github-dark',
        user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
}

// TypeBox Schema Definitions
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

// -------------------------------------------------------------
// ACTIONS (CRUD + Public Retrieval + Markdown Rendering)
// -------------------------------------------------------------

/**
 * createPage: Create a new publication page
 */
export const createPage = defineAction({
  name: "createPage",
  description: "Create a new document/page in the publishing workspace",
  input: t.Object({
    slug: t.String({
      minLength: 2,
      maxLength: 100,
      pattern: "^[a-z0-9-]+$",
      description: "URL-friendly unique slug (lowercase letters, numbers, dashes)",
    }),
    title: t.String({ minLength: 1, maxLength: 200 }),
    content: t.String({ minLength: 1 }),
    contentType: t.Optional(
      t.Union([t.Literal("markdown"), t.Literal("html")], { default: "markdown" })
    ),
    isPublic: t.Optional(t.Boolean({ default: false })),
    theme: t.Optional(
      t.Union(
        [
          t.Literal("github-dark"),
          t.Literal("github-light"),
          t.Literal("dracula"),
          t.Literal("nord"),
        ],
        { default: "github-dark" }
      )
    ),
  }),
  output: PageSchema,
  errors: {
    SLUG_EXISTS: { status: 409, message: "A page with this slug already exists" },
  },
  execute: async ({ input, ctx, error }): Promise<Page> => {
    initPagesDatabase();
    const db = ctx.db ?? pagesService.getDb();

    // Check slug collision
    const existing = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.slug, input.slug));

    if (existing.length > 0) {
      error.SLUG_EXISTS(`Slug '${input.slug}' is already taken`);
    }

    const now = new Date().toISOString();
    const newPage: Page = {
      id: `pg_${Math.random().toString(36).substring(2, 10)}`,
      slug: input.slug,
      title: input.title,
      content: input.content,
      contentType: input.contentType ?? "markdown",
      isPublic: input.isPublic ?? false,
      theme: input.theme ?? "github-dark",
      userId: ctx.user?.id ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(pagesTable).values(newPage);
    ctx.logger.info(`Page created: '${newPage.title}' (slug: /${newPage.slug})`);

    return newPage;
  },
});

/**
 * getPage: Retrieve page by internal ID
 */
export const getPage = defineAction({
  name: "getPage",
  description: "Retrieve a page by its internal ID",
  input: t.Object({
    id: t.String(),
  }),
  output: PageSchema,
  errors: {
    NOT_FOUND: { status: 404, message: "Page not found" },
  },
  execute: async ({ input, ctx, error }): Promise<Page> => {
    initPagesDatabase();
    const db = ctx.db ?? pagesService.getDb();
    const [page] = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, input.id));

    if (!page) {
      error.NOT_FOUND(`Page with ID '${input.id}' does not exist`);
    }

    return page;
  },
});

/**
 * getPublicPage: Fetch a published page by slug (publicly accessible, no auth required)
 */
export const getPublicPage = defineAction({
  name: "getPublicPage",
  description: "Get a published page by slug (public reading surface)",
  input: t.Object({
    slug: t.String(),
  }),
  output: PageSchema,
  errors: {
    NOT_FOUND: { status: 404, message: "Published page not found" },
  },
  execute: async ({ input, ctx, error }): Promise<Page> => {
    initPagesDatabase();
    const db = ctx.db ?? pagesService.getDb();
    const [page] = await db
      .select()
      .from(pagesTable)
      .where(and(eq(pagesTable.slug, input.slug), eq(pagesTable.isPublic, true)));

    if (!page) {
      error.NOT_FOUND(`Published page '/${input.slug}' not found or is private`);
    }

    return page;
  },
});

/**
 * listPages: List pages with filtering and search
 */
export const listPages = defineAction({
  name: "listPages",
  description: "List pages with optional filtering by visibility and search query",
  input: t.Object({
    limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
    isPublic: t.Optional(t.Boolean()),
  }),
  output: t.Object({
    pages: t.Array(PageSchema),
    total: t.Number(),
  }),
  execute: async ({ input, ctx }) => {
    initPagesDatabase();
    const db = ctx.db ?? pagesService.getDb();

    let query = db.select().from(pagesTable);
    if (input.isPublic !== undefined) {
      query = query.where(eq(pagesTable.isPublic, input.isPublic)) as any;
    }

    const all = await query;
    const limit = input.limit ?? 50;
    const sliced = all.slice(0, limit);

    return {
      pages: sliced,
      total: all.length,
    };
  },
});

/**
 * updatePage: Update document content, title, theme, or visibility
 */
export const updatePage = defineAction({
  name: "updatePage",
  description: "Update page content, metadata, theme, or publication status",
  input: t.Object({
    id: t.String(),
    title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
    content: t.Optional(t.String()),
    isPublic: t.Optional(t.Boolean()),
    theme: t.Optional(
      t.Union([
        t.Literal("github-dark"),
        t.Literal("github-light"),
        t.Literal("dracula"),
        t.Literal("nord"),
      ])
    ),
  }),
  output: PageSchema,
  errors: {
    NOT_FOUND: { status: 404, message: "Page not found" },
  },
  execute: async ({ input, ctx, error }): Promise<Page> => {
    initPagesDatabase();
    const db = ctx.db ?? pagesService.getDb();

    const [existing] = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, input.id));

    if (!existing) {
      error.NOT_FOUND(`Page with ID '${input.id}' not found`);
    }

    const updates: Partial<Page> = {
      updatedAt: new Date().toISOString(),
    };
    if (input.title !== undefined) updates.title = input.title;
    if (input.content !== undefined) updates.content = input.content;
    if (input.isPublic !== undefined) updates.isPublic = input.isPublic;
    if (input.theme !== undefined) updates.theme = input.theme;

    await db.update(pagesTable).set(updates).where(eq(pagesTable.id, input.id));

    const [updated] = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, input.id));

    return updated;
  },
});

/**
 * deletePage: Remove a page from the workspace
 */
export const deletePage = defineAction({
  name: "deletePage",
  description: "Delete a page by its ID",
  input: t.Object({
    id: t.String(),
  }),
  output: t.Object({
    success: t.Boolean(),
    id: t.String(),
  }),
  errors: {
    NOT_FOUND: { status: 404, message: "Page not found" },
  },
  execute: async ({ input, ctx, error }) => {
    initPagesDatabase();
    const db = ctx.db ?? pagesService.getDb();

    const [existing] = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, input.id));

    if (!existing) {
      error.NOT_FOUND(`Page with ID '${input.id}' not found`);
    }

    await db.delete(pagesTable).where(eq(pagesTable.id, input.id));
    return { success: true, id: input.id };
  },
});

/**
 * renderPage: Prepares a published page for reading, extracting TOC and styling
 */
export const renderPage = defineAction({
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
  errors: {
    NOT_FOUND: { status: 404, message: "Page not found" },
  },
  execute: async ({ input, ctx, error }) => {
    initPagesDatabase();
    const db = ctx.db ?? pagesService.getDb();

    const [page] = await db
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

// Register actions on pagesService
pagesService
  .action(createPage)
  .action(getPage)
  .action(getPublicPage)
  .action(listPages)
  .action(updatePage)
  .action(deletePage)
  .action(renderPage);
