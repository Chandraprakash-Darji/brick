import assert from "node:assert/strict";
import { app } from "./app";

const base = "/api/pageComment";
const request = (method: string, path: string, input?: unknown) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    }),
  );
const post = (path: string, input: unknown) => request("POST", path, input);
try {
  const created = await post(`${base}`, {
    targetId: "page-1",
    body: "  Hello Brick!  ",
  });
  assert.equal(created.status, 200);
  const comment = await created.json();
  assert.equal(comment.body, "Hello Brick!");
  const read = await request("GET", `${base}/${comment.id}`);
  assert.equal((await read.json()).id, comment.id);
  const where = { field: "targetId", op: "eq", value: "page-1" };
  assert.equal(
    (await (await post(`${base}/query`, { where })).json()).items.length,
    1,
  );
  assert.equal(
    (
      await (
        await post(`${base}/query`, {
          where: { ...where, value: "page-2" },
        })
      ).json()
    ).items.length,
    0,
  );
  assert.deepEqual(await (await post(`${base}/count`, { where })).json(), {
    count: 1,
  });
  assert.equal(
    (await post(`${base}`, { targetId: "page-1", body: " " })).status,
    400,
  );
  assert.equal(
    (await post(`${base}`, { targetId: "missing", body: "Hi" })).status,
    404,
  );
  const updated = await request("PATCH", `${base}/${comment.id}`, {
    body: "  Updated!  ",
  });
  assert.equal((await updated.json()).body, "Updated!");
  assert.equal(
    (await request("PATCH", `${base}/${comment.id}`, { body: " " })).status,
    400,
  );
  assert.deepEqual(
    await (await request("DELETE", `${base}/${comment.id}`)).json(),
    {
      success: true,
    },
  );
  assert.deepEqual(await (await post(`${base}/count`, { where })).json(), {
    count: 0,
  });
  console.log(
    "Comments: create, trim, target checks, filters, count, update and delete passed.",
  );
} finally {
  await app.dispose();
}
