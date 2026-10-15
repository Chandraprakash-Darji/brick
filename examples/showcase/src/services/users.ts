import { Brick } from "@brickkit/core";
import { NotFound } from "@brickkit/core/contracts";
import { Effect, Schema } from "effect";

const users = new Map([["usr_42", { id: "usr_42", name: "Ada" }]]);
const GetUser = Brick.action("getUser", "/api/users/getUser", {
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
  errors: [NotFound],
});
export const getUser = GetUser(({ id }) => {
  const user = users.get(id);
  return user
    ? Effect.succeed(user)
    : Effect.fail(new NotFound({ message: "User not found" }));
});
export const usersService = Brick.service("users", { actions: { getUser } });
