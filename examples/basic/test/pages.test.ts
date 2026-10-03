import { describe, it, expect, beforeEach } from "bun:test";
import { createBrickServer } from "@brick-ts/cli";
import {
  pagesService,
  createPage,
  getPage,
  getPublicPage,
  listPages,
  updatePage,
  deletePage,
  renderPage,
  initPagesDatabase,
  pagesTable,
} from "../src/services/pages/service";

describe("Pages Service E2E Tests (Mirroring ../pages)", () => {
  let app: ReturnType<typeof createBrickServer>;

  beforeEach(async () => {
    initPagesDatabase();
    const db = pagesService.getDb();
    if (db) {
      await db.delete(pagesTable);
    }
    app = createBrickServer({ services: [pagesService] });
  });

  describe("createPage", () => {
    it("should successfully create a new markdown page", async () => {
      const page = await createPage({
        input: {
          slug: "getting-started",
          title: "Getting Started with Pages",
          content: "# Welcome to Pages\nA minimalist publishing workspace.",
          contentType: "markdown",
          isPublic: true,
          theme: "nord",
        },
      });

      expect(page.id).toStartWith("pg_");
      expect(page.slug).toBe("getting-started");
      expect(page.title).toBe("Getting Started with Pages");
      expect(page.isPublic).toBe(true);
      expect(page.theme).toBe("nord");
    });

    it("should reject slug with invalid characters via TypeBox validation", async () => {
      expect(
        createPage({
          input: {
            slug: "INVALID SLUG!",
            title: "Bad Slug",
            content: "Some content",
          },
        })
      ).rejects.toThrow("Validation failed for action 'createPage' input");
    });

    it("should reject duplicate slug with 409 SLUG_EXISTS error", async () => {
      await createPage({
        input: {
          slug: "unique-post",
          title: "First Post",
          content: "Hello world",
        },
      });

      expect(
        createPage({
          input: {
            slug: "unique-post",
            title: "Second Post with Same Slug",
            content: "Duplicate content",
          },
        })
      ).rejects.toThrow("already taken");
    });
  });

  describe("getPublicPage & getPage", () => {
    it("should retrieve a public page by slug", async () => {
      await createPage({
        input: {
          slug: "public-announcement",
          title: "Public Launch",
          content: "# We are live!",
          isPublic: true,
        },
      });

      const res = await app.handle(
        new Request("http://localhost:4000/api/pages/getPublicPage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: "public-announcement" }),
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.slug).toBe("public-announcement");
      expect(data.title).toBe("Public Launch");
    });

    it("should return 404 for draft (non-public) page via getPublicPage", async () => {
      await createPage({
        input: {
          slug: "secret-draft",
          title: "Internal Notes",
          content: "Confidential",
          isPublic: false,
        },
      });

      const res = await app.handle(
        new Request("http://localhost:4000/api/pages/getPublicPage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: "secret-draft" }),
        })
      );

      expect(res.status).toBe(404);
      const err = await res.json();
      expect(err.code).toBe("NOT_FOUND");
    });
  });

  describe("renderPage & TOC extraction", () => {
    it("should extract Table of Contents headings from Markdown content", async () => {
      await createPage({
        input: {
          slug: "guide",
          title: "Developer Guide",
          content: `# Introduction
Here is the intro.

## Quickstart
Get started quickly.

### Step 1
Do step 1.

## Architecture
How it works.`,
          isPublic: true,
          theme: "dracula",
        },
      });

      const rendered = await renderPage({ input: { slug: "guide" } });
      expect(rendered.theme).toBe("dracula");
      expect(rendered.toc.length).toBe(4);
      expect(rendered.toc[0]).toEqual({
        level: 1,
        id: "introduction",
        text: "Introduction",
      });
      expect(rendered.toc[1]).toEqual({
        level: 2,
        id: "quickstart",
        text: "Quickstart",
      });
      expect(rendered.toc[2]).toEqual({
        level: 3,
        id: "step-1",
        text: "Step 1",
      });
      expect(rendered.toc[3]).toEqual({
        level: 2,
        id: "architecture",
        text: "Architecture",
      });
    });
  });

  describe("updatePage & deletePage", () => {
    it("should update page title, theme and content", async () => {
      const created = await createPage({
        input: {
          slug: "mutable-doc",
          title: "Draft Title",
          content: "Draft content",
          theme: "github-light",
        },
      });

      const updated = await updatePage({
        input: {
          id: created.id,
          title: "Final Title",
          theme: "nord",
          isPublic: true,
        },
      });

      expect(updated.title).toBe("Final Title");
      expect(updated.theme).toBe("nord");
      expect(updated.isPublic).toBe(true);
    });

    it("should delete page from database", async () => {
      const created = await createPage({
        input: {
          slug: "temp-doc",
          title: "Temporary",
          content: "Will be deleted",
        },
      });

      const deleteRes = await deletePage({ input: { id: created.id } });
      expect(deleteRes.success).toBe(true);

      expect(getPage({ input: { id: created.id } })).rejects.toThrow("does not exist");
    });
  });

  describe("listPages", () => {
    it("should list pages and filter by public visibility", async () => {
      await createPage({
        input: { slug: "pub-1", title: "Public 1", content: "c", isPublic: true },
      });
      await createPage({
        input: { slug: "pub-2", title: "Public 2", content: "c", isPublic: true },
      });
      await createPage({
        input: { slug: "draft-1", title: "Draft 1", content: "c", isPublic: false },
      });

      const all = await listPages({ input: {} });
      expect(all.total).toBe(3);

      const publicOnly = await listPages({ input: { isPublic: true } });
      expect(publicOnly.total).toBe(2);
      expect(publicOnly.pages.every((p) => p.isPublic)).toBe(true);
    });
  });
});
