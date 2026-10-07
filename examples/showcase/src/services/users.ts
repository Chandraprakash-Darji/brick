import { defineService, t } from "@elregaldo/core";

const users = new Map([["usr_42", { id: "usr_42", name: "Ada" }]]);
export const usersService = defineService("users");

export const getUser = usersService.action({
  name: "getUser",
  input: t.Object({ id: t.String() }),
  execute: ({ input, error }) => {
    const user = users.get(input.id);
    if (!user) error.NOT_FOUND("User not found");
    return user;
  },
});
