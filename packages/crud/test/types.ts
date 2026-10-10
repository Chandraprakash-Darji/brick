import { defineService } from "@brickkit/core";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { crud } from "../src";
const table = sqliteTable("typed", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  secret: text("secret"),
});
const service = defineService("typed_crud");
const resource = service.resource({ name: "typed", table, id: table.id }).use(
  crud({
    fields: {
      id: { read: true, filter: ["eq", "in"] },
      name: {
        read: true,
        create: true,
        update: true,
        filter: ["contains"],
        sort: true,
      },
      email: {
        read: true,
        scrub: ({ value }): string | null => (value === null ? null : "masked"),
      },
    },
    operations: { delete: false },
  }),
);
const result = resource.list.run({
  select: ["id", "email"],
  where: { field: "id", op: "in", value: [1, 2] },
});
result.then((rows) => {
  const id: number = rows.items[0].id;
  const email: string | null = rows.items[0].email;
  void id;
  void email;
  // @ts-expect-error name was not selected
  void rows.items[0].name;
});
resource.create.run({ name: "A" });
resource.update.run({ id: 1, data: { name: "B" } });
// @ts-expect-error hidden field cannot be selected
resource.list.run({ select: ["secret"] });
// @ts-expect-error operation disabled
void resource.delete;
// @ts-expect-error field not writable
resource.create.run({ name: "A", secret: "hidden" });
// @ts-expect-error field not updateable
resource.update.run({ id: 1, data: { email: "x" } });
// @ts-expect-error numeric ID does not accept string
resource.get.run({ id: "wrong" });
// @ts-expect-error contains is not allowed for id
resource.list.run({ where: { field: "id", op: "contains", value: "1" } });
// @ts-expect-error typed filter value
resource.list.run({ where: { field: "id", op: "eq", value: "1" } });
// @ts-expect-error email not sortable
resource.list.run({ orderBy: [{ field: "email", direction: "asc" }] });
const empty = service
  .resource({ name: "empty", table })
  .use(crud({ fields: {}, operations: false }));
// @ts-expect-error disabled plugin contributes no operations
void empty.list;

resource.get.run({ id: 1, select: ["id"] }).then((row) => {
  const id: number = row.id;
  void id;
  // @ts-expect-error non-selected field
  void row.name;
});
