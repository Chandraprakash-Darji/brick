# Brick compiler v1

Brick compiles service definitions into specialized JavaScript handlers for
Bun and Elysia. A request stays in Bun's JavaScript runtime from HTTP receipt
through `execute` and response serialization.

## Compilation plan

1. **Analyze definitions — implemented.** Resolve REST resources, default action
   paths, custom paths/methods, input precedence, query coercions, validation,
   context and authorization into a versioned, frozen IR. Report shadowed routes.
2. **Generate and bind handlers — implemented.** Emit the required execution
   stages for each route. Bind live action/context/auth callbacks, database
   handles, logger/error helpers and cached TypeBox validators once. Synchronous
   actions without async context/auth stages return directly. Promise results,
   rejections and thenables are supported.
3. **Build application artifacts — implemented.** `brick build` emits inspectable
   IR and handler source, then bundles the definitions, generated handlers and
   runtime into a Bun server. Startup checks the definitions against the IR before
   binding. The built handlers need no handler source generation at startup.
4. **Profile and expand specialization — ongoing.** Compare against the general
   handler with identical responses and policies. Specialize declared input
   sources only after defining an explicit API for their semantics. Investigate
   context allocations and serialization before changing them.
5. **Database reads — implemented for generated resources.** Describe GET,
   default list and COUNT SQL in the IR; prepare those queries during binding.
   Prepare separate owner-scoped and unscoped lists. Standard pagination skips
   rebuilding query SQL per request. Rich filters, sorts, projections, search and
   cursors retain their existing execution paths. The expanded paired suite
   measures SQLite; PostgreSQL measurement is still pending. A compiler cannot
   automatically convert arbitrary user-written Drizzle code into a prepared query.
6. **Database writes — implemented for Bun SQLite resources.** Prime common
   INSERT/UPDATE field combinations and lazily cache other shapes (64 per
   operation/resource/DB). Bind values through Drizzle encoders. `RETURNING`
   removes post-write row SELECTs when no triggers could change the row;
   ownership/before-update reads remain. Dynamic JS defaults, SQL expressions,
   hook accessors and lookup-key changes retain the existing write/readback path.
7. **Built-in responses — implemented.** Render docs, Swagger and opt-in Scalar
   reference HTML once when creating the server. Serialize architecture and
   OpenAPI once, refreshing after registry/definition changes or raw endpoint
   additions. Health keeps live uptime and timestamp values per request.
8. **Router experiments — next.** Compare a Bun-native router adapter against
   Elysia using the same compiled handlers.

Stages 1–3, generated resource read/write plans and built-in response preparation
are implemented. Their performance is measured by the paired compiler benchmark.
Benchmark throughput and p99 together before making performance claims.

## Use

Startup compilation is enabled by default:

```ts
import { createBrickServer } from '@elregaldo/cli';
const app = createBrickServer({ services: [pagesService] });
app.listen(4000);
```

For an application build, use a definitions module that registers services and
resources without starting a server:

```sh
brick build src/definitions.ts --outdir dist/brick --port 4000
bun dist/brick/server.js
# Override the built default port:
PORT=8080 bun dist/brick/server.js
```

Other build options: `--prefix /v1` and `--no-request-logging`.

The output directory contains:

- `brick-ir.json`: route metadata, schema projections, resource read SQL and diagnostics.
- `routes.js`: generated ES-module handler factories and the IR binder.
- `server.js` / `server.js.map`: runnable bundle, including application callbacks.

`routes.js` uses `@elregaldo/cli/compiler` when used independently. `server.js`
bundles these handlers and their imports; the source definitions are not needed
at deployment. File-backed databases, assets and environment variables used by
application code remain deployment requirements.

The build **imports and evaluates your definitions module**. Top-level user code
runs during build and again at runtime. Current compilation is not static AST
analysis, and it does not sandbox user code or guarantee a build without database
initialization. Keep migrations, seeding, demo execution and server startup in
separate entrypoints. Env-dependent route definitions must be the same at build
and startup; mismatches fail with a rebuild instruction.

## Inspect or embed

```ts
import {
  compileBrickApplication,
  emitCompiledApplication,
} from '@elregaldo/cli/compiler';

const compilation = compileBrickApplication({ services: [pagesService], prefix: '/api' });
console.log(compilation.ir);
const generatedSource = emitCompiledApplication(compilation.ir);
```

The IR contains JSON schema projections for inspection and mismatch detection.
Those projections are not deserialized into TypeBox schemas: runtime checks bind
the original schemas, preserving TypeBox symbols, formats and validator behavior.
TypeBox validator compilation still happens once at startup; pre-emitting
validator code is a separate future optimization.

For comparison or rollback, `createBrickServer({ compiler: false })` uses the
original general action handler. Raw `app.endpoint()` handlers remain on their
existing adapter. Direct/RPC action calls retain their core execution path.

## Request contract

The compiler preserves resource REST mappings, action aliases, custom methods,
query coercions and input merge precedence. It keeps the existing execution
order: context hook → input validation → authorization → execute → output
validation. Errors retain their status and JSON shape. Trace/request headers and
per-request context isolation remain enabled. User/session context is never shared
between requests. Action callbacks are not stringified or inspected to guess
which context fields they access.

Routes with no input schema do not request body/query/params from Elysia, so the
framework does not parse unused bodies, including malformed JSON. Routes with
an input schema retain the existing body/query/params merge rules; the compiler
does not silently switch a route to params-only input.

Definitions and route configuration should be finalized before creating the
server. Change definitions and rebuild/recreate the server to change handlers.

## Compiled GET/list queries

Resource GET, list and COUNT statements are prepared when the compiler binds a
service. Drizzle executes these prepared queries and maps database columns back
to the declared row keys/types. Standard list requests using only `limit`,
`offset` and `page` reuse the default sort/projection and SQL. Owner-scoped lists
bind the current request's user ID for both the page query and COUNT. GET keeps
the existing row ownership check and NOT_FOUND/FORBIDDEN error helpers.

Each request queries the database again. IDs, user IDs, limits and offsets are
parameters; rows/counts are never cached. Query caches are separated by database
and resource plan, including when different services use the same resource name.

Explicit filters/sorts/projections, search and cursor pagination continue through
the general resource implementation and its existing query-shape cache. Unknown
adapters, an unavailable schema during preparation, or a failed prepared query
retain the dynamic query fallback. Context/auth/input/output validation remain
in the compiled HTTP handler. A context hook can still supply a different DB;
that DB retains the existing query path until it has its own prepared plans.

SQL in `ir.reads` is an inspection artifact. The binder constructs/prepares
Drizzle statements once at startup; it does not execute raw serialized IR SQL
or stringify arbitrary custom action callbacks. Only SQLite execution has been
verified so far; PostgreSQL still needs integration/throughput measurements.

## All framework-owned HTTP routes

Generated handlers cover resource **create, get, list, PATCH/PUT update and
DELETE**, their action aliases, and custom actions. Input/output checks,
context, auth, hooks and error handling retain the request contract. Bun SQLite
INSERT/UPDATE reuse prepared SQL for safe field combinations; other adapters
and unsupported shapes keep the dynamic path. Delete retains its existing
prepared-query cache. Handler compilation does not precompute write results.

The HTTP adapter also prepares `/_brick/services`, `/openapi.json`, `/docs`,
`/swagger` and opt-in `/reference` responses. Stable HTML uses Elysia static
responses; JSON routes reuse serialized bytes. Architecture tracks registry
identity and revision; `register`, `clear`, service `action`, `resource` and
`setDb` invalidate the cache. OpenAPI also tracks `app.endpoint()` additions.
Direct mutation of action config objects after server creation is unsupported:
finalize definitions before compilation. `/_health` uses its minimal synchronous
handler and calculates uptime/timestamp on every request.

Built-in HTML/JSON preparation happens at server creation, including in the AOT
bundle; these routes are not action factories in `brick-ir.json`. Elysia remains
the HTTP router. `compiler: false` renders/serializes metadata per request for
the paired baseline.

## Prepared writes and RETURNING

Startup compilation and the AOT binder enable Bun SQLite INSERT/UPDATE plans.
Common required/full insert and individual/full update field combinations are
prepared while binding. Other shapes are prepared on first use, with a maximum
of 64 shapes per operation, resource plan and DB. Values are never cached;
Drizzle retains physical-column names, placeholders, encoders and row mappers.
The generic benchmark target does not enable these plans.

For safe shapes with a unique lookup key and no triggers, create uses INSERT RETURNING instead of
INSERT then SELECT. Update keeps its existing pre-write SELECT for NOT_FOUND,
ownership and beforeUpdate hooks, then uses UPDATE RETURNING instead of a final
SELECT. afterCreate/afterUpdate still receive the resulting mapped row. Hooks
that change the lookup key retain the original readback contract.

Two lightweight main/temp SQLite schema-version probes run before each prepared
write. DDL invalidates cached statements and trigger inventory. Any persistent
or temporary trigger disables RETURNING for these plans, including possible
cross-table effects: prepared writes then retain the post-write SELECT. Schema
probes are included in benchmark latency/throughput. This also handles triggers
added or dropped after compilation.

Omitted `$defaultFn`/`$onUpdateFn` values retain dynamic builders so their JS
functions run per write, never while priming or once per cached shape. SQL/column
expressions from hooks, accessors/nonstandard prototypes, lookup-key changes,
null insert IDs, physical-name idField aliases, full caches, failed preparation and other DB
adapters retain the original dynamic write/readback path. A context-supplied DB
without its own write plans also retains that path. Preparation failure can fall
back safely; execution/mapping failure is propagated and never replays a write.
Non-unique lookup keys keep the original post-write SELECT even with a prepared
write, preserving which matching row is returned. PostgreSQL writes remain
unchanged pending integration tests.

Write SQL is bound/prepared at startup or on first use, not serialized into
`ir.reads`. This extension optimizes generated resource actions, not arbitrary
SQL inside custom execute callbacks.
