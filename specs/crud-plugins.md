# Service, resource, and CRUD plugins

Baseline: local `beta` at `ec03a53`. Plugin infrastructure commit: `a09125c`.
CRUD implementation branch: `feat/crud-resource-plugin`.
Worktree: `/Users/rega/.t3/worktrees/brick-ts/feat-crud-resource-plugin`.

## Ownership

Core provides `defineServicePlugin`, `defineResourcePlugin`, `.use()`, generic
resource declarations, action/endpoint bindings, and compiler preparation
contributions. Core and CLI do not import CRUD. `@brickkit/crud` supplies CRUD as
a resource plugin. It replaces the previous proposal for
`service.use(crud()).resource(config)`.

```ts
import {
  defineDatabase,
  defineService,
  sqliteTable,
  text,
} from "@brickkit/core";
import { crud } from "@brickkit/crud";

const leads = sqliteTable("leads", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email"),
  privateNotes: text("private_notes"),
});
const database = defineDatabase({ tables: { leads } });
const service = defineService("crm", { database });
const lead = service.resource({ name: "lead", table: leads, id: leads.id }).use(
  crud({
    fields: {
      id: { read: true, filter: ["eq", "in"] },
      name: {
        read: true,
        create: true,
        update: true,
        filter: ["eq", "contains"],
        sort: true,
      },
      email: {
        read: true,
        create: true,
        update: true,
        scrub: ({ value }) =>
          value === null ? null : value.replace(/^(.).*(@.*)$/, "$1***$2"),
      },
    },
  }),
);
```

The application creates and migrates its tables. Declarations, installation,
build, and requests never mutate schemas. A resource's identifier must belong
to its table. Omitting `id` infers a single primary key; ambiguous keys fail.

All behavior options belong to plugins. A comments plugin's `table`, column
mapping, and `fields` describe its comment table, not the parent table. Its setup
receives the parent resource, which determines the target. Install independently
on page and post resources, with explicit separate comment tables and target-ID
column mappings. This change does not ship a comments package, polymorphic
relations, lookup, bulk writes, upsert, or nested writes.

## Fields and queries

Unlisted fields and omitted capabilities are disabled. Read, create, update,
filter operator allowlists, and sort permission are independent. Schema overrides
belong to individual field policies. Unknown fields, unreadable projections,
unwritable inputs, prohibited filters/operators, and prohibited ordering fail
both local and HTTP validation. Nullability, database defaults, JSON, enums, and
actual identifier types must survive schema derivation.

A scrubber receives the field value and execution context. It changes returned
values after SQL, including list, get, findOne, create, and update results and
local calls. It never modifies stored data. Hooks normalize writes separately.
Server row scoping combines with caller filters using AND and applies to every
read, count, existence check, update, and delete. Authorization also applies to
local calls. Create supplies trusted ownership values through explicit policy
or hooks. No timestamp, owner, searchable-field, or projection-name guessing.

Queries use JSON `where` expressions with `and`/`or` groups and typed field
comparisons, `select`, `orderBy`, limit/offset pagination, and optional totals.
Operators include equality, membership, comparisons/ranges, text matching and
null checks only where the column type and configured allowlist permit them.
Select must preserve exact local selected-field types where possible. Browser
contracts must represent projection omissions truthfully.

## Default routes

Paths respect the app prefix, which defaults to `/api`.

- `POST /lead/query`: list with JSON query; no duplicate GET list route.
- `GET /lead/:id`: primary-key lookup; missing records return NOT_FOUND.
- `POST /lead`: create.
- `PATCH /lead/:id`: partial update; input separates `{ id, data }`.
- `DELETE /lead/:id`: delete.
- `POST /lead/find-one`: projected first match, or null.
- `POST /lead/count`: `{ count }`.
- `POST /lead/exists`: `{ exists }`.

Each is an ordinary local action contributed as `lead.list`, `lead.get`,
`lead.create`, `lead.update`, `lead.delete`, `lead.findOne`, `lead.count`, and
`lead.exists`. Static paths take precedence over parameter paths. No PUT
replacement semantics are introduced.

## Author APIs and exposure

Service factories return descriptors from `defineServicePlugin`, whose setup
receives `{ service, routes }`. Resource factories use `defineResourcePlugin`,
whose setup receives `{ service, resource, routes }` and returns named API
contributions. `resource.use()` returns the resource with inferred contributions;
retain the returned value for static typing. Namespaces such as `{ comments:
commentsApi }` remain supported. Generic host-dependent contribution types retain
the resource table and service context without a core dependency on CRUD.

`routes.action()` registers a validated JSON action and a custom HTTP binding.
`routes.endpoint()` registers a raw endpoint for streams, HTML, or webhooks.
Routes have stable names and explicit app/service/resource scopes. Resource is
the default for resource plugins, service for service plugins. App scope still
uses the app prefix.

Consumers configure `routes: false`, `routes: { list: false }`, or named path and
scope overrides such as `routes: { count: { path: "/lead-count", scope: "app" } }`.
Disabled HTTP actions remain locally callable but disappear from HTTP, OpenAPI,
and generated browser contracts. No ordinary fallback route re-exposes them.
`operations: false` removes all CRUD capabilities. Per-operation false removes
that action both locally and remotely, including from inferred APIs.

## Identity and lifecycle

The same descriptor on the same host reuses the installation. Another descriptor
with the same name on that host fails even if its options appear equal. Reuse a
descriptor for one configured installation. Install it on a different resource
for an independent instance. Multiple differently configured resources do not
collide merely because they share the CRUD descriptor name.

Setup is synchronous registration before build. Cycles, late installation,
closed registrars, duplicate actions/route names, invalid overrides, and API
contribution collisions fail. Installation rollback restores declarations,
preparations, dependencies, and resource properties. Arbitrary external side
effects are outside rollback and do not belong in setup.

Method/path collisions fail at app construction, including equivalent dynamic
paths and raw endpoints. Compiler preparation declarations are generic named
contributions with serializable descriptions and preparation callbacks. The
compiler records them and invokes callbacks without knowing CRUD. CRUD retains
prepared query execution for stable shapes and dynamic execution for variable
queries; both enforce identical policies, projection and scrubbing.

## Implementation and acceptance

1. Replace core CRUD resources with generic hosts and generic preparation
   contributions, preserving existing plugin lifecycle and typing.
2. Implement the CRUD resource plugin with field policy, query schemas, access
   policies, hooks, default routes, and operation/exposure controls.
3. Feed action metadata into CLI routes, OpenAPI and browser clients. Remove
   CRUD-specific transport and preparation branches. Verify compiled and generic
   execution against the same database and prefix.
4. Update repository examples and current website docs directly. Replace
   `registerComments(service)` with plugin composition. No migration guide.
5. Test actual SQLite execution, caller input failures, hidden-field protection,
   scrubbed write/read outputs, defaults/nulls, multiple resources, scoped access,
   route disabling/overrides, collisions, operation removal, precise table/field
   types, compiled parity, and preparation descriptions. Run repository lint,
   formatting, builds, typechecks, tests, and changed website/example checks.
6. Delegate independent review, fix supported findings, rerun affected checks,
   and commit this increment. Do not push or open a PR.
