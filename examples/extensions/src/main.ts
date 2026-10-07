import assert from "node:assert/strict";
import { app, commentsExtension } from "./app";

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
const created = await request("/api/comment", "POST", {
  targetId: "page-1",
  body: "  Hello Brick!  ",
});
assert.equal(created.status, 200);
const comment = await created.json();
assert.equal(comment.body, "Hello Brick!");
const read = await request(`/api/comment/${comment.id}`);
assert.equal(read.status, 200);
assert.equal((await read.json()).id, comment.id);
const listed = await request("/api/comment?targetId=page-1");
assert.equal(listed.status, 200);
assert.equal((await listed.json()).items.length, 1);
const otherTarget = await request("/api/comment?targetId=page-2");
assert.equal((await otherTarget.json()).items.length, 0);

const counted = await request("/api/comments/count?targetId=page-1");
assert.deepEqual(await counted.json(), { count: 1 });
// The custom action can also be called directly in process.
assert.deepEqual(
  await commentsExtension.countComments({ input: { targetId: "page-1" } }),
  {
    count: 1,
  },
);

const rejected = await request("/api/comment", "POST", {
  targetId: "page-1",
  body: "   ",
});
assert.equal(rejected.status, 400);
const updated = await request(`/api/comment/${comment.id}`, "PATCH", {
  body: "  Updated!  ",
});
assert.equal(updated.status, 200);
assert.equal((await updated.json()).body, "Updated!");
const blankUpdate = await request(`/api/comment/${comment.id}`, "PATCH", {
  body: " ",
});
assert.equal(blankUpdate.status, 400);
const removed = await request(`/api/comment/${comment.id}`, "DELETE");
assert.equal(removed.status, 200);
assert.deepEqual(
  await commentsExtension.countComments({ input: { targetId: "page-1" } }),
  {
    count: 0,
  },
);
console.log(
  "Comments extension: create, trim, count, reject blank input, update and delete passed.",
);
