import { expect, test } from "bun:test";
import { Brick } from "@brickkit/core";
import { Effect, Layer } from "effect";
import { NotFound } from "@brickkit/core/contracts";
import { getUser, usersService } from "../src/services/users";

test("the same users action returns data locally and through HTTP", async () => {
  expect(await Effect.runPromise(getUser.handler({ id: "usr_42" }))).toEqual({
    id: "usr_42",
    name: "Ada",
  });
  expect(
    await Effect.runPromise(
      getUser.handler({ id: "missing" }).pipe(Effect.flip),
    ),
  ).toBeInstanceOf(NotFound);
  const app = Brick.app({ services: [usersService], layer: Layer.empty });
  const call = (input: unknown) =>
    app.fetch(
      new Request("http://localhost/api/users/getUser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  try {
    const response = await call({ id: "usr_42" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "usr_42", name: "Ada" });
    const missing = await call({ id: "missing" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      _tag: "NotFound",
      message: "User not found",
    });
    expect((await call({ id: 123 })).status).toBe(400);
  } finally {
    await app.dispose();
  }
});
