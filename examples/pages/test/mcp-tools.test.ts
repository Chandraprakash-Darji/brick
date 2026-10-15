import { describe, expect, test } from "bun:test";
import { prepareTestDatabase } from "./database";
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("native shared tool handlers over HTTP", () => {
  test("preserves metadata/content separation, ownership, rendering, and explicit false", async () => {
    const db = await prepareTestDatabase();
    try {
      const owner = await db.signup("tools@example.com");
      const call = (name: string, input: unknown) =>
        db.request(`/api/pages/${name}`, input, owner.cookie);
      const created = await call("create_page", {
        title: "Tool page",
        slug: "tool-page",
        contentType: "markdown",
        isPublic: true,
      });
      expect(created.status).toBe(200);
      const page = await created.json();
      expect(page.content).toBeUndefined();
      expect(
        (await call("create_page", { title: "Duplicate", slug: "tool-page" }))
          .status,
      ).toBe(409);
      expect((await call("echo", { message: "hi" })).status).toBe(200);
      expect(await (await call("whoami", {})).json()).toContain(
        owner.body.user.id,
      );
      expect(
        await (
          await call("upload_content", { id: page.id, content: "# Hello 🌍" })
        ).json(),
      ).toContain("12 bytes");
      expect(
        await (await call("get_page_content", { id: page.id })).json(),
      ).toBe("# Hello 🌍");
      expect(
        await (await call("render_page", { id: page.id })).json(),
      ).toContain("<!DOCTYPE html>");
      const edited = await (
        await call("edit_page", { id: page.id, isPublic: false })
      ).json();
      expect(edited.isPublic).toBe(false);
      expect(edited.contentType).toBe("markdown");
      expect((await (await call("list_pages", {})).json()).length).toBe(1);
      expect(
        (await db.request("/api/pages/get_public_page", { slug: "tool-page" }))
          .status,
      ).toBe(404);
      await call("delete_page", { id: page.id });
      expect((await call("get_page", { id: page.id })).status).toBe(404);
    } finally {
      await db.close();
    }
  }, 30000);
});
