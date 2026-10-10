# @brickkit/crud

Opt-in auto-CRUD resource plugin for Brick-TS. Core resources declare identity
and a table but register no actions; `crud()` adds typed list/get/create/
update/delete/findOne/count/exists operations with HTTP routes.

```sh
bun add @brickkit/crud
```

```ts
import { defineService } from "@brickkit/core";
import { crud } from "@brickkit/crud";

const page = service.resource({ name: "page", table: pages, id: pages.id }).use(
  crud({
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

| Method | Path                 | Action  |
| ------ | -------------------- | ------- |
| POST   | `/api/page/query`    | list    |
| GET    | `/api/page/:id`      | get     |
| POST   | `/api/page`          | create  |
| PATCH  | `/api/page/:id`      | update  |
| DELETE | `/api/page/:id`      | delete  |
| POST   | `/api/page/find-one` | findOne |
| POST   | `/api/page/count`    | count   |
| POST   | `/api/page/exists`   | exists  |

`operations: { delete: false }` (or `operations: false`) removes local
capabilities. `routes: { list: false }` (or `routes: false`) keeps local
actions callable without HTTP, OpenAPI, or browser exposure. `defaultLimit`
(default 20) and `maxLimit` (default 100) bound pagination.

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

See `www/content/docs/(brick)/resources.mdx` for the full guide.
