import { describe, it, expect, beforeEach } from "bun:test";

import { prepareTestDatabase } from "./database";

import {
  pagesService as svc,
  pagesResource,
  pagesTable as table,
} from "../src/api/services/pages/service";
import { getPublicPageTool as getPublicPage } from "../src/api/services/pages/page/actions/get-public-page";

const {
  create: createPage,
  get: getPage,
  list: listPages,
  update: updatePage,
  delete: deletePage,
} = pagesResource;

const alice = { user: { id: "user_alice" } };
const bob = { user: { id: "user_bob" } };

async function resetDb() {
  if (svc?.getDb && table) {
    const db = svc.getDb();
    if (db) await db.delete(table);
  }
}

async function call(action: any, input: any, ctx?: any) {
  return action({ ctx, input });
}

describe("pages CRUD (owner-scoped Postgres)", () => {
  beforeEach(async () => {
    await prepareTestDatabase();
    await resetDb();
  });

  it("owner-scoped create stamps the caller's user id", async () => {
    const page = await call(
      createPage,
      {
        content: "# hi",
        contentType: "markdown",
        isPublic: false,
        slug: "alice-note",
        theme: "nord",
        title: "Alice Note",
      },
      alice,
    );
    expect(page.slug).toBe("alice-note");
    expect(page.title).toBe("Alice Note");
    // Owner field may be `userId` (camel) or `user_id` (snake) depending on port.
    const owner = (page as any).userId ?? (page as any).user_id;
    expect(owner).toBe("user_alice");
  });

  it("owner can get their own page; others are rejected", async () => {
    const created = await call(
      createPage,
      { content: "c", slug: "owned", title: "Owned" },
      alice,
    );
    const fetched = await call(getPage, { id: created.id }, alice);
    expect(fetched.id).toBe(created.id);
    await expect(call(getPage, { id: created.id }, bob)).rejects.toThrow(
      /access denied|not.*(found|exist)|forbidden/i,
    );
  });

  it("list is scoped to the calling owner", async () => {
    await call(createPage, { content: "c", slug: "a-1", title: "A1" }, alice);
    await call(createPage, { content: "c", slug: "a-2", title: "A2" }, alice);
    await call(createPage, { content: "c", slug: "b-1", title: "B1" }, bob);
    const aliceList = await call(listPages, {}, alice);
    const bobList = await call(listPages, {}, bob);
    const alicePages =
      aliceList.pages ?? aliceList.items ?? aliceList.data ?? [];
    const bobPages = bobList.pages ?? bobList.items ?? bobList.data ?? [];
    expect(aliceList.total ?? alicePages.length).toBe(2);
    expect(bobList.total ?? bobPages.length).toBe(1);
    expect(bobPages[0]!.slug).toBe("b-1");
  });

  it("owner can update; non-owner update is rejected", async () => {
    const created = await call(
      createPage,
      { content: "c", slug: "mutable", theme: "github-light", title: "Draft" },
      alice,
    );
    await expect(
      call(updatePage, { id: created.id, title: "Hacked" }, bob),
    ).rejects.toThrow(/access denied|not.*(found|exist)|forbidden/i);
    const updated = await call(
      updatePage,
      { id: created.id, isPublic: true, theme: "nord", title: "Final" },
      alice,
    );
    expect(updated.title).toBe("Final");
    expect(updated.theme).toBe("nord");
  });

  it("owner can delete; deleted pages are gone", async () => {
    const created = await call(
      createPage,
      { content: "c", slug: "temp", title: "Temp" },
      alice,
    );
    await expect(call(deletePage, { id: created.id }, bob)).rejects.toThrow(
      /access denied|not.*(found|exist)|forbidden|success/i,
    );
    const res = await call(deletePage, { id: created.id }, alice);
    expect((res as any).success ?? true).toBe(true);
    {
      await expect(call(getPage, { id: created.id }, alice)).rejects.toThrow(
        /not.*(found|exist)/i,
      );
    }
  });

  it("rejects duplicate slug with conflict (SLUG_EXISTS)", async () => {
    await call(
      createPage,
      { content: "c", slug: "dup", title: "First" },
      alice,
    );
    await expect(
      call(createPage, { content: "c", slug: "dup", title: "Second" }, alice),
    ).rejects.toThrow(/already taken|conflict|unique|slug_exists/i);
  });

  it("public visibility: public readable, drafts hidden from public reader", async () => {
    await call(
      createPage,
      { content: "# pub", isPublic: true, slug: "pub-page", title: "Pub" },
      alice,
    );
    await call(
      createPage,
      {
        content: "hidden",
        isPublic: false,
        slug: "draft-page",
        title: "Draft",
      },
      alice,
    );
    const pub = await call(getPublicPage, { slug: "pub-page" });
    expect(pub.slug).toBe("pub-page");
    await expect(call(getPublicPage, { slug: "draft-page" })).rejects.toThrow(
      /not found/i,
    );
    await expect(call(getPublicPage, { slug: "missing-page" })).rejects.toThrow(
      /not found/i,
    );
  });

  it("list can filter by public visibility", async () => {
    await call(
      createPage,
      { content: "c", isPublic: true, slug: "p-1", title: "P1" },
      alice,
    );
    await call(
      createPage,
      { content: "c", isPublic: true, slug: "p-2", title: "P2" },
      alice,
    );
    await call(
      createPage,
      { content: "c", isPublic: false, slug: "d-1", title: "D1" },
      alice,
    );
    const all = await call(listPages, {}, alice);
    expect(all.total ?? all.pages?.length).toBe(3);
    const pubOnly = await call(listPages, { isPublic: true }, alice);
    const pages = pubOnly.pages ?? pubOnly.items ?? [];
    expect(pubOnly.total ?? pages.length).toBe(2);
    for (const p of pages) {
      const isPub = (p as any).isPublic ?? (p as any).is_public;
      expect(isPub).toBe(true);
    }
  });
});
