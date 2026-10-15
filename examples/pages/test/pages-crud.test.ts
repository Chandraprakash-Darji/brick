import { describe, expect, test } from "bun:test";
import { prepareTestDatabase } from "./database";
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("native owner-scoped HTTP CRUD", () => {
  test("cookie sessions, ownership, filters, conflict, updates, and public HTML", async () => {
    const db = await prepareTestDatabase();
    try {
      const alice = await db.signup("alice@example.com"),
        bob = await db.signup("bob@example.com");
      expect((await db.request("/api/pages/page/query", {}, "")).status).toBe(
        401,
      );
      const created = await db.request(
        "/api/pages/page",
        {
          title: "Native page",
          slug: "native-page",
          content: "# Hello",
          isPublic: true,
        },
        alice.cookie,
        "POST",
      );
      expect(created.status).toBe(200);
      const page = await created.json();
      expect(page.userId).toBe(alice.body.user.id);
      expect(
        (
          await db.request(
            `/api/pages/page/${page.id}`,
            undefined,
            bob.cookie,
            "GET",
          )
        ).status,
      ).toBe(404);
      const list = await (
        await db.request(
          "/api/pages/page/query",
          {
            includeTotal: true,
            where: { field: "isPublic", op: "eq", value: true },
          },
          alice.cookie,
          "POST",
        )
      ).json();
      expect(list.total).toBe(1);
      expect(list.items[0].id).toBe(page.id);
      expect(
        (
          await (
            await db.request("/api/pages/page/query", {}, bob.cookie, "POST")
          ).json()
        ).items,
      ).toEqual([]);
      expect(
        (
          await db.request(
            "/api/pages/page",
            {
              title: "Duplicate",
              slug: "native-page",
              content: "",
            },
            alice.cookie,
            "POST",
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await db.request(
            `/api/pages/page/${page.id}`,
            { title: "Stolen" },
            bob.cookie,
            "PATCH",
          )
        ).status,
      ).toBe(404);
      const updated = await (
        await db.request(
          `/api/pages/page/${page.id}`,
          { title: "Changed" },
          alice.cookie,
          "PATCH",
        )
      ).json();
      expect(updated.title).toBe("Changed");
      const html = await db.request("/p/native-page");
      expect(html.status).toBe(200);
      expect(await html.text()).toContain("Hello");
      await db.request(
        `/api/pages/page/${page.id}`,
        { isPublic: false },
        alice.cookie,
        "PATCH",
      );
      expect((await db.request("/p/native-page")).status).toBe(404);
      expect(
        (
          await db.request(
            `/api/pages/page/${page.id}`,
            undefined,
            alice.cookie,
            "DELETE",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await db.request(
            `/api/pages/page/${page.id}`,
            undefined,
            alice.cookie,
            "GET",
          )
        ).status,
      ).toBe(404);
    } finally {
      await db.close();
    }
  }, 30000);
});
