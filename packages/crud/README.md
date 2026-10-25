# @brickkit/crud

Opt-in auto-CRUD resource plugin for Brick-TS. Core resources declare identity
and a table but register no actions; `crud()` adds typed list/get/create/
update/delete/findOne/count/exists operations with HTTP routes.

You need Bun 1.2 or later and `@brickkit/core` as a peer dependency.

```sh
bun add @brickkit/crud @brickkit/core
```

```ts
import { defineService } from "@brickkit/core";
import { crud } from "@brickkit/crud";

const service = defineService("pages");
const page = service.resource({ name: "page", table: pages, id: pages.id }).use(
  crud({
    access: "public",
    fields: {
      id: { read: true, filter: ["eq", "in"] },
      title: {
        read: true,
        create: true,
        update: true,
        filter: ["eq", "contains"],
        sort: true,
      },
    },
  }),
);

await page.list.run({ where: { field: "title", op: "contains", value: "Hi" } });
```

`access` is required: use `"public"` or an `authorize`/`scope` policy.

`authorize` receives validated input as an operation-discriminated union.
Checking `operation` narrows `input` to that operation's shape:

```ts
crud({
  fields: { teamId: { read: true, filter: ["eq"] } },
  access: {
    authorize: ({ operation, input, ctx }) => {
      if (operation === "list" && input.where && "field" in input.where) {
        const filter = input.where;
        return filter.field === "teamId" && filter.value === ctx.teamId;
      }
      return false;
    },
  },
});
```

`CrudAuthorizeArgs<F>` and `CrudInputs<F>` are exported for reusable policies
and per-operation inputs, with `F` supplied as `typeof fields`. Field policies
constrain selections, writes, sorting, and filter operators. Explicit field
schemas provide value types. Column-derived values and IDs remain `unknown`
because `crud()` receives the table only when the plugin attaches to a resource.
Create properties remain optional because column defaults and nullability are
also unavailable at configuration time. `scope` still receives only
`{ operation, ctx }`.
Unlisted fields and omitted permissions stay disabled.

## Field policies

`read`, `create`, `update`, `filter`, and `sort` are independent. Unlisted
fields and omitted permissions are disabled. `schema` overrides validation
for a field; `scrub` transforms returned values (reads and write results)
without changing stored values.

Filter operators must be enabled per field and compatible with the column
type: text operators (`contains`, `startsWith`, `endsWith`) require string
columns; ordered operators (`gt`, `gte`, `lt`, `lte`, `between`) require
string/number/date/bigint columns. Sorting is supported for
string/number/boolean/date/bigint columns.

## Operations and routes

| Method | Path                    | Action     |
| ------ | ----------------------- | ---------- |
| POST   | `/api/page/query`       | list       |
| GET    | `/api/page/:id`         | get        |
| POST   | `/api/page`             | create     |
| PATCH  | `/api/page/:id`         | update     |
| DELETE | `/api/page/:id`         | delete     |
| POST   | `/api/page/find-one`    | findOne    |
| POST   | `/api/page/count`       | count      |
| POST   | `/api/page/exists`      | exists     |
| POST   | `/api/page/bulk-create` | bulkCreate |
| POST   | `/api/page/bulk-update` | bulkUpdate |
| POST   | `/api/page/bulk-delete` | bulkDelete |

`operations: { delete: false }` (or `operations: false`) removes local
capabilities. `routes: { list: false }` (or `routes: false`) keeps local
actions callable without HTTP, OpenAPI, or browser exposure. `defaultLimit`
(default 20) and `maxLimit` (default 100) bound pagination.

The bulk operations are off until `operations` sets them to `true`.
`bulkCreate` takes `{ items }`, `bulkUpdate` takes `{ items: [{ id, data }] }`
and `bulkDelete` takes `{ ids }`. Each item is validated, authorized, scoped
and hooked as its single-row operation would be. The whole batch is one
transaction: when an item fails, nothing is kept, and the error carries the
item's code and `details: { index, code, message }`. `maxBatchSize`
(default 100) caps the items per call.

## Hooks and transactions

`beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`
and `afterDelete` run inside the write's transaction and receive it as `tx`.
Write other tables through `tx`, or call another resource with
`{ ...ctx, db: tx }`, and the writes commit or roll back with the row. A hook
that throws rolls the whole operation back. `afterCommit` runs after the
commit, for cache clears and realtime publishes. Its errors are logged, not
returned.

## Local vs HTTP row precision

Local `list`/`get` actions are typed `Selected<T, F, S>` — the `select`
projection narrows the return type. Over HTTP every readable key is optional
in the row schema because `select` projections omit keys, so validate
presence client-side when using `select`.

## Security properties

- Only allowlisted fields, operators, and sort columns reach SQL; unknown
  projections, writes, filters, and ordering fail validation with a 400.
- `where` supports nested `and`/`or` arrays up to 20 levels; deeper nesting
  is rejected with a 400 before validation recurses.
- `contains`/`startsWith`/`endsWith` escape `LIKE` wildcards (`%`, `_`, `\`).
- `access.scope` constrains every read and mutation (including local action
  calls); scoped creation is rejected without an explicit create policy.
- Unique violations return 409 without leaking driver errors.
- Read queries reuse bounded prepared statements (128-entry cache) where the
  driver supports them.

See the [resources guide](https://brickkit.dev/docs/resources) for the full
guide.
