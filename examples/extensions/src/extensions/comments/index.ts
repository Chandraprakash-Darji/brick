import { ActionExecutionError, defineResourcePlugin, eq } from "@brickkit/core";
import { crud } from "@brickkit/crud";
import { commentsTable } from "./schema";
export { commentsTable } from "./schema";

/** This example uses the parent table's ID as the comment target. */
export function comments(options: { table: typeof commentsTable }) {
  return defineResourcePlugin({
    name: "example/comments",
    setup({ resource, service }) {
      const comment = service
        .resource({
          name: `${resource.name}Comment`,
          table: options.table,
          id: options.table.id,
        })
        .use(
          crud({
            fields: {
              id: { read: true, filter: ["eq"] },
              targetId: { read: true, create: true, filter: ["eq"] },
              body: {
                read: true,
                create: true,
                update: true,
                filter: ["contains"],
              },
            },
            hooks: {
              beforeCreate: async ({ data, ctx }) => {
                data.body = String(data.body).trim();
                if (!data.body)
                  throw new ActionExecutionError(
                    "BAD_REQUEST",
                    "Comment body cannot be blank",
                    400,
                  );
                const parents = await ctx.db
                  .select({ id: resource.id })
                  .from(resource.table)
                  .where(eq(resource.id, data.targetId))
                  .limit(1);
                if (!parents.length)
                  throw new ActionExecutionError(
                    "NOT_FOUND",
                    "Comment target not found",
                    404,
                  );
              },
              beforeUpdate: ({ data }) => {
                if (data.body !== undefined) {
                  data.body = String(data.body).trim();
                  if (!data.body)
                    throw new ActionExecutionError(
                      "BAD_REQUEST",
                      "Comment body cannot be blank",
                      400,
                    );
                }
              },
            },
          }),
        );
      return { comments: comment };
    },
  });
}
