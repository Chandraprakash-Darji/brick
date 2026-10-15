# @brickkit/crud

Typed CRUD contracts and handlers for Drizzle tables, built on Effect. One
declaration produces `list`, `findOne`, `get`, `create`, `update`, `delete`,
`count`, and `exists` actions with field-level policies.

## Contract

The contract is browser-safe: it contains schemas and metadata, no handlers.

```ts
import { crudContract } from "@brickkit/crud";
import { Unauthorized } from "@brickkit/core/contracts";

export const pageContract = crudContract({
  name: "page",
  path: "/api/pages/page",
  table: pagesTable,
  id: "id",
  errors: [Unauthorized],
  limits: { default: 20, max: 100 },
  fields: {
    id: { read: true, filter: ["eq", "in"] },
    slug: {
      read: true,
      create: true,
      update: true,
      filter: ["eq", "contains"],
      sort: true,
    },
    title: { read: true, create: true, update: true, sort: true },
    userId: { read: true },
  },
});
```

Only fields marked `read` appear in responses, `create`/`update` control the
write schemas, and `filter`/`sort` control what may be queried. Read rows are
exactly typed: every readable field is required and keeps its column type.

## Implementation

```ts
import { postgresStore } from "@brickkit/crud";

export const actions = pageContract.implement({
  store: postgresStore(pagesTable, Database.Service),
  access: {
    authorize: () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        return user !== null;
      }),
    // Optional: restrict rows per operation with a Drizzle SQL condition.
    scope: ({ operation }) =>
      Effect.succeed(
        operation === "create" ? undefined : eq(pagesTable.userId, "u1"),
      ),
  },
  hooks: {
    beforeCreate: ({ data }) => Effect.succeed({ ...data }),
  },
});
```

Hooks, scrubbers, and policies are Effects: they may require services and may
fail with the errors declared on the contract. Their requirements flow into
the resulting actions, so `Brick.app({ layer })` must provide them.

## Errors

`InvalidInput`, `Forbidden`, `NotFound`, `Conflict`, and `DatabaseFailure` are
built in and added to every action alongside your declared `errors`.

## Entry points

| Import                    | Contents                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `@brickkit/crud`          | `crudContract`, `crud`, built-in errors, `sqliteStore`, `postgresStore`, `database` |
| `@brickkit/crud/sqlite`   | `sqliteDatabase` (Drizzle + `@effect/sql-sqlite-bun`)                               |
| `@brickkit/crud/postgres` | `postgresDatabase` (Drizzle + `@effect/sql-pg`)                                     |

`select` projection is not part of the contract: rows are always returned in
full so response types are exact.
