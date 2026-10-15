import { expect, test } from "bun:test";
import { createApp } from "../src/app";
import { Effect } from "effect";
import { DatabaseLive } from "../src/database";
import { comments, InvalidComment } from "../src/extensions/comments";

const request = (
  app: ReturnType<typeof createApp>["app"],
  method: string,
  path: string,
  body?: unknown,
) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers:
        body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );

test("comments reject missing, null and blank bodies without inserting", async () => {
  const { app } = createApp();
  try {
    for (const input of [
      { targetId: "page-1" },
      { targetId: "page-1", body: null },
      ...["", "   ", "\n\t"].map((body) => ({ targetId: "page-1", body })),
    ]) {
      expect(
        (await request(app, "POST", "/api/pageComment", input)).status,
      ).toBe(400);
      expect(
        await (await request(app, "POST", "/api/pageComment/count", {})).json(),
      ).toEqual({
        count: 0,
      });
    }
    expect(
      (
        await request(app, "POST", "/api/pageComment", {
          targetId: "missing",
          body: "Hello",
        })
      ).status,
    ).toBe(404);
    const created = await request(app, "POST", "/api/pageComment", {
      targetId: "page-1",
      body: "  Hello  ",
    });
    expect(created.status).toBe(200);
    const row = await created.json();
    expect(row.body).toBe("Hello");
    const blankUpdate = await request(
      app,
      "PATCH",
      `/api/pageComment/${row.id}`,
      { body: " " },
    );
    expect(blankUpdate.status).toBe(400);
    expect(
      (await (await request(app, "GET", `/api/pageComment/${row.id}`)).json())
        .body,
    ).toBe("Hello");
    expect(
      await (await request(app, "POST", "/api/pageComment/count", {})).json(),
    ).toEqual({
      count: 1,
    });
  } finally {
    await app.dispose();
  }
});

test("comment handlers run locally with the database supplied by a Layer", async () => {
  const actions = comments();
  await Effect.runPromise(
    Effect.gen(function* () {
      const row = yield* actions["pageComment.create"].handler({
        payload: {
          targetId: "page-1",
          body: "  Local  ",
        },
      });
      expect(row.body).toBe("Local");
      expect(
        yield* actions["pageComment.count"].handler({ payload: {} }),
      ).toEqual({
        count: 1,
      });
      expect(
        yield* actions["pageComment.create"]
          .handler({ payload: { targetId: "page-1", body: " " } })
          .pipe(Effect.flip),
      ).toBeInstanceOf(InvalidComment);
    }).pipe(Effect.provide(DatabaseLive)),
  );
});
