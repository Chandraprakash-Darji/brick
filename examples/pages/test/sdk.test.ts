import { describe, expect, test } from "bun:test";
import { createClient } from "@brickkit/client";
import { NotFound } from "@brickkit/crud";
import { Api } from "../src/api/contract";
import { prepareTestDatabase } from "./database";
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("native Promise client", () => {
  test("decodes schema results and tagged errors through the real listener", async () => {
    const db = await prepareTestDatabase();
    const owner = await db.signup("sdk@example.com");
    const server = Bun.serve({ port: 0, fetch: db.app.fetch });
    const connection = await createClient(Api, {
      baseUrl: server.url,
      fetchOptions: { headers: { cookie: owner.cookie } },
    });
    try {
      const api = connection.client.pages;
      const created = await api["page.create"]({
        payload: { title: "SDK", slug: "sdk-page", content: "body" },
      });
      expect(created.id).toBeString();
      expect((await api["page.list"]({ payload: {} })).items).toHaveLength(1);
      expect(await api.echo({ payload: { message: "client" } })).toContain(
        "Echo: client",
      );
      await expect(
        api["page.get"]({ params: { id: "missing" } }),
      ).rejects.toBeInstanceOf(NotFound);
    } finally {
      await connection.dispose();
      await server.stop(true);
      await db.close();
    }
  }, 30000);
});
