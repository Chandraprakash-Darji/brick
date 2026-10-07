import { eq, sql, t, type BunSQLiteDatabase, type Service } from "@brickkit/core";
import { commentsTable } from "./schema";

export { commentsTable } from "./schema";

export function registerComments<TDb extends BunSQLiteDatabase<any>, TContext extends Record<string, unknown>>(
  service: Service<TDb, TContext>,
) {
  const comments = service.resource({
    name: "comment",
    table: commentsTable,
    idGenerator: () => crypto.randomUUID(),
    hooks: {
      beforeCreate: ({ data, error }) => {
        data.body = data.body.trim();
        if (!data.body) error.BAD_REQUEST("Comment body cannot be blank");
      },
      beforeUpdate: ({ data, error }) => {
        if (data.body !== undefined) {
          data.body = data.body.trim();
          if (!data.body) error.BAD_REQUEST("Comment body cannot be blank");
        }
      },
    },
  });

  const countComments = service.action({
    name: "countComments",
    path: "/api/comments/count",
    method: "GET",
    input: t.Object({ targetId: t.String({ minLength: 1 }) }),
    output: t.Object({ count: t.Integer({ minimum: 0 }) }),
    execute: ({ input, ctx }) => {
      const [row] = ctx.db.select({ count: sql<number>`count(*)` })
        .from(commentsTable).where(eq(commentsTable.targetId, input.targetId)).all();
      return { count: row!.count };
    },
  });

  return { comments, countComments };
}
