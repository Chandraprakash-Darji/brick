import assert from "node:assert/strict";
import { app, page } from "./app";

// Exercise the real compiled HTTP routes without opening a listening socket.
const request = (path: string, method = "GET", body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
const created = await request("/api/pageComment", "POST", {
  targetId: "page-1",
  body: "  Hello Brick!  ",
});
assert.equal(created.status, 200);
const comment = await created.json();
assert.equal(comment.body, "Hello Brick!");
const read = await request(`/api/pageComment/${comment.id}`);
assert.equal(read.status, 200);
assert.equal((await read.json()).id, comment.id);
const listed = await request("/api/pageComment/query", "POST", {
  where: { field: "targetId", op: "eq", value: "page-1" },
});
assert.equal(listed.status, 200);
assert.equal((await listed.json()).items.length, 1);
const otherTarget = await request("/api/pageComment/query", "POST", {
  where: { field: "targetId", op: "eq", value: "page-2" },
});
assert.equal((await otherTarget.json()).items.length, 0);

const counted = await request("/api/pageComment/count", "POST", {
  where: { field: "targetId", op: "eq", value: "page-1" },
});
assert.deepEqual(await counted.json(), { count: 1 });
// The custom action can also be called directly in process.
assert.deepEqual(
  await page.comments.count({
    input: { where: { field: "targetId", op: "eq", value: "page-1" } },
  }),
  {
    count: 1,
  },
);

const rejected = await request("/api/pageComment", "POST", {
  targetId: "page-1",
  body: "   ",
});
assert.equal(rejected.status, 400);
const updated = await request(`/api/pageComment/${comment.id}`, "PATCH", {
  data: { body: "  Updated!  " },
});
assert.equal(updated.status, 200);
assert.equal((await updated.json()).body, "Updated!");
const blankUpdate = await request(`/api/pageComment/${comment.id}`, "PATCH", {
  data: { body: " " },
});
assert.equal(blankUpdate.status, 400);
const removed = await request(`/api/pageComment/${comment.id}`, "DELETE");
assert.equal(removed.status, 200);
assert.deepEqual(
  await page.comments.count({
    input: { where: { field: "targetId", op: "eq", value: "page-1" } },
  }),
  {
    count: 0,
  },
);
console.log(
  "Comments extension: create, trim, count, reject blank input, update and delete passed.",
);
