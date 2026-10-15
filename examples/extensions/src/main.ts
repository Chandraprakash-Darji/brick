import assert from "node:assert/strict";
import { app } from "./app";

const request = (operation: string, input: unknown) =>
  app.fetch(
    new Request(`http://localhost/api/pageComment/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
try {
  const created = await request("create", {
    targetId: "page-1",
    body: "  Hello Brick!  ",
  });
  assert.equal(created.status, 200);
  const comment = await created.json();
  assert.equal(comment.body, "Hello Brick!");
  const read = await request("get", { id: comment.id });
  assert.equal((await read.json()).id, comment.id);
  const where = { field: "targetId", op: "eq", value: "page-1" };
  assert.equal(
    (await (await request("list", { where })).json()).items.length,
    1,
  );
  assert.equal(
    (
      await (
        await request("list", { where: { ...where, value: "page-2" } })
      ).json()
    ).items.length,
    0,
  );
  assert.deepEqual(await (await request("count", { where })).json(), {
    count: 1,
  });
  assert.equal(
    (await request("create", { targetId: "page-1", body: " " })).status,
    400,
  );
  assert.equal(
    (await request("create", { targetId: "missing", body: "Hi" })).status,
    404,
  );
  const updated = await request("update", {
    id: comment.id,
    data: { body: "  Updated!  " },
  });
  assert.equal((await updated.json()).body, "Updated!");
  assert.equal(
    (await request("update", { id: comment.id, data: { body: " " } })).status,
    400,
  );
  assert.deepEqual(await (await request("delete", { id: comment.id })).json(), {
    success: true,
  });
  assert.deepEqual(await (await request("count", { where })).json(), {
    count: 0,
  });
  console.log(
    "Comments: create, trim, target checks, filters, count, update and delete passed.",
  );
} finally {
  await app.dispose();
}
