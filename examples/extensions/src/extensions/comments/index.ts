import { sqliteStore } from "@brickkit/crud";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { Database } from "../../database";
import { commentsTable, pages } from "./schema";
import { Comments, InvalidComment, MissingTarget } from "./contract";
export { Comments, InvalidComment, MissingTarget } from "./contract";
export { commentsTable } from "./schema";

export function comments() {
  return Comments.implement({
    store: sqliteStore(commentsTable, Database.Service),
    access: "public",
    hooks: {
      beforeCreate: ({ data }) =>
        Effect.gen(function* () {
          const body = data.body.trim();
          if (!body)
            return yield* Effect.fail(
              new InvalidComment({ message: "Comment body cannot be blank" }),
            );
          const db = yield* Database.Service;
          const parents = yield* db
            .select({ id: pages.id })
            .from(pages)
            .where(eq(pages.id, data.targetId))
            .limit(1)
            .pipe(Effect.orDie);
          if (!parents.length)
            return yield* Effect.fail(
              new MissingTarget({ message: "Comment target not found" }),
            );
          return { ...data, body };
        }),
      beforeUpdate: ({ data }) => {
        if (data.body === undefined) return Effect.succeed(data);
        const body = data.body.trim();
        return body
          ? Effect.succeed({ ...data, body })
          : Effect.fail(
              new InvalidComment({ message: "Comment body cannot be blank" }),
            );
      },
    },
  });
}
