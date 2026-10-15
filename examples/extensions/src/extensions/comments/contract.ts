import { crudContract } from "@brickkit/crud";
import { Schema } from "effect";
import { commentsTable } from "./schema";

export class InvalidComment extends Schema.TaggedError<InvalidComment>()(
  "InvalidComment",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}
export class MissingTarget extends Schema.TaggedError<MissingTarget>()(
  "MissingTarget",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

// A reusable extension is a contract and a factory for handlers with explicit dependencies.
export const Comments = crudContract({
  name: "pageComment",
  path: "/api/pageComment",
  table: commentsTable,
  id: "id",
  errors: [InvalidComment, MissingTarget],
  fields: {
    id: { read: true, filter: ["eq"] },
    targetId: { read: true, create: true, filter: ["eq"] },
    body: { read: true, create: true, update: true, filter: ["contains"] },
  },
});
