import { brick } from "../../src/server";
import { defineService, t } from "@brickkit/core";

export const records = defineService("records");
records.tool({
  name: "get_value",
  http: true,
  path: "/v2/records/:doctype/value",
  method: "POST",
  input: t.Object({
    doctype: t.Literal("CRMDeal"),
    fields: t.Array(t.String()),
  }),
  output: t.String(),
  errors: { MISSING: { status: 404, message: "Missing record" } },
  execute: ({ input }) => `${input.doctype}:${input.fields.join(",")}`,
});
records.tool({
  name: "search",
  http: true,
  method: "POST",
  input: t.Object({ term: t.String(), limit: t.Optional(t.Number()) }),
  output: t.Array(t.String()),
  execute: ({ input }) => [input.term],
});
records.tool({ name: "private_tool", execute: () => "__backend_only__" });

export const users = defineService("users");
users.tool({
  name: "profile.get",
  http: true,
  path: "/v2/users/:id",
  method: "GET",
  input: t.Object({ id: t.String(), details: t.Optional(t.Boolean()) }),
  output: t.Object({
    id: t.String(),
    roles: t.Array(t.Union([t.Literal("admin"), t.Literal("member")])),
  }),
  execute: ({ input }) => ({ id: input.id, roles: ["member"] }),
});
users.tool({
  name: "update",
  http: true,
  path: "/v2/users/update",
  method: "PATCH",
  input: t.Object({ id: t.String(), name: t.String() }),
  output: t.Boolean(),
  execute: () => true,
});

const unselected = defineService("unselected");
unselected.action({ name: "hidden", execute: () => "__unselected__" });
export default brick({
  services: [records, users],
  prefix: "/v2",
  requestLogging: false,
});
