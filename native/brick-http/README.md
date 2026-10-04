# Brick native HTTP (experimental)

`brick-http` owns the public HTTP listener and consumes `brickc` execution
artifacts. Eligible SQLite resource CRUD requests execute SQL,
map rows and serialize JSON entirely in Rust. In `--runtime rust` mode, the Rust
router is a Node-API addon loaded into Bun. Custom actions and endpoints run on
Bun's JavaScript thread through a thread-safe callback, without a private HTTP
listener or a second HTTP request. Elysia is not imported by this native path.
The existing Bun runtime remains available and still uses Elysia.

## Run through the CLI

```sh
bun run build:compiler
bun run build:native-http  # Builds the standalone binaries and the .node addon
export BRICKC="$PWD/native/brickc/target/release/brickc"
export BRICK_HTTP_ADDON="$PWD/native/brick-http/target/release/brick-http.node"

bun packages/cli/src/bin.ts build app.ts --runtime rust
bun packages/cli/src/bin.ts start app.ts --runtime rust --port 4000
# Or compile on startup:
bun packages/cli/src/bin.ts dev app.ts --runtime rust --port 4000
```

The default addon path is `native/brick-http/target/release/brick-http.node`
relative to the working directory. Set `BRICK_HTTP_ADDON` for an installed CLI
or a different build location. Prebuilt npm native binaries are not packaged yet.
`bun run build:native-bridge` builds only the addon.

An installed CLI uses the same flags with `brick build/dev/start`. The entry
registers services; the CLI starts the Rust listener in the Bun process.
The native resource adapter still requires file-backed SQLite: it opens an
independent Rust connection, rather than borrowing Bun's `:memory:` handle.
Applications still own schema initialization and migrations.

The CLI binds Rust to `127.0.0.1:PORT`. `app.stop()` and SIGINT/SIGTERM stop the
listener and release the callback bridge. Native shutdown cancels active HTTP
requests; it does not interrupt arbitrary JavaScript code already running.
Responses carry `x-brick-runtime: rust` and retain request/trace IDs. That header
identifies the public listener; a custom handler still executes JavaScript.

For comparison, the previous separate-process HTTP bridge remains available:

```sh
export BRICK_HTTP="$PWD/native/brick-http/target/release/brick-http"
brick start app.ts --runtime rust --bridge http
```

Programmatic applications can import `createNativeWorker`, `compilePlans`, and
`startInProcessHttp` from `@elregaldo/cli/native`. Register raw endpoints before
starting the listener. This entry point does not load the Elysia adapter.

## Custom action execution

```text
Rust HTTP routing / URL parameters / JSON body and query parsing
  → compiled Rust input validation
  → Bun context and authorization callbacks, then execute({ input, ctx, error })
  → compiled Rust output validation
  → Rust HTTP response
```

Schemas are compiled once at startup. Common JSON-compatible TypeBox objects,
arrays, unions, primitives, literals, and numeric/length constraints use Rust's
`jsonschema` validator. Generated resource fallback actions keep their existing
TypeBox checks. Patterns, formats, references, transforms, custom TypeBox types,
and other unsupported keywords keep TypeBox validation on the same in-process
callback path. Unusual numeric query coercions and non-JSON body formats also
retain JS input handling. No HTTP hop is reintroduced for these fallbacks.

Rust validation preserves `ValidationError`, status 400/500, action name,
`errors` paths/messages/values, but individual error messages come from the Rust
validator and can differ from TypeBox's wording. Input validation runs before
context/auth callbacks, so invalid native inputs do not trigger those callbacks.
Output validation applies when `output` is declared; a TypeScript return-type
annotation alone does not provide a runtime schema.

`execute`, Drizzle queries, context hooks, authorization and error helpers remain
in TypeScript. Sync handlers and Promise-returning handlers are supported, and
custom `Response` endpoints preserve status, headers, redirects and cookies.
The bridge uses owned request/response buffers and a bounded request body
(16 MiB). Callback waits time out after 30 seconds. Responses are buffered;
streaming/backpressure and WebSocket upgrade support are not implemented here.
A native fault now shares the Bun process, unlike the isolated HTTP bridge.

## Current route ownership

Native plans contain physical projection, primary-key lookup, count and ordered
page SQL, logical field names, column decoders and pagination settings.
The compiler emits these descriptors only for supported generated resource
reads selected by the authoring adapter. Startup validates artifacts and
prepares queries before listening. Native responses preserve trace/request IDs;
per-request access logging remains a future native adapter feature.

Rust also owns `GET /_health` and `GET /_brick/services`. Health reports the
native listener's uptime and current Unix timestamp in milliseconds. Architecture
is serialized once from the global registry at startup and served from immutable
bytes. OpenAPI, Scalar docs, Swagger, and optional reference pages are also rendered
once at startup and their response bytes are served directly by Rust.
These built-in endpoints do not invoke the JavaScript callback; registering
services after startup requires restarting to refresh the snapshot.

Rust owns eligible REST GET collection/item routes. Plain generated SQLite
create/update/delete operations also execute in Rust using transactions and
parameterized statements. Native writes require an unchanged generated action,
a string primary key, no custom ID generator, no column defaults/update callbacks,
and no timestamp columns. Configured ID prefixes are preserved; generated suffixes
are opaque and differ from the TypeScript generator. Missing-record errors are
returned directly by Rust. Standard list pagination
supports `limit`, `offset` and `page`. Lists retain the plural array, `items`,
count, page metadata and next-cursor format. No payload or count is cached.
String, numeric and boolean SQLite columns are supported.

The following continue through Bun: custom actions, action aliases, unsupported writes,
resources with ownership/context/authorization/hooks/custom schemas/errors,
modified generated action implementations, unsupported column decoders, and
list filters/search/sort/select/cursor inputs. Invalid pagination, unsupported
write body formats and invalid write schemas also go through Bun to preserve existing error responses (in-process by default). Native eligibility
checks the original generated action/schema definitions; callbacks are not
silently omitted. This is a staged resource runtime; native policy callbacks,
richer queries and full schema/default support are not implemented yet.

The HTTP fallback preserves methods, paths, query strings, headers, status
codes and bodies. It removes hop-by-hop headers, disables redirect following,
has a 30-second upstream timeout, and buffers bodies (16 MiB request limit).
Streaming/proxy backpressure and PostgreSQL execution remain future work.

## Standalone router (HTTP bridge)

```sh
brick-http --plans .brick/plans.json --databases databases.json \
  --architecture architecture.json \
  --upstream http://127.0.0.1:PRIVATE_BUN_PORT --listen 127.0.0.1:4000
```

`architecture.json` is the JSON output of `getGlobalRegistry().exportArchitecture()`.
`databases.json` maps service names to SQLite file paths. The upstream must be
a Brick Bun server with the matching application registrations. It is a
trusted artifact and database configuration, not request-supplied input.

## Benchmarks

The `brick-http-bench` binary is a standalone architecture prototype with typed
fixed JSON/list handlers and a custom-action proxy. Its numbers are separate
from the artifact-driven runtime.

```sh
bun run build:native-http
# Separate server processes, existing Bun load generator:
bun run bench:native
# External oha loader, explicit HTTP/1.1 and concurrency 16:
bun run bench:native --oha /path/to/oha --requests 50000 --rounds 5
# Actual compiled native router, including tracing and generic row mapping:
bun run bench:native --integrated --oha /path/to/oha --requests 50000 --rounds 5
# Compare direct Brick, HTTP bridge, and in-process bridge, including async Drizzle actions/docs:
bun run bench:native --integrated --inprocess --oha /path/to/oha --requests 50000 --rounds 5
```

In the integrated benchmark the fixed-JSON action is a custom TypeScript action,
so `fixed.rust-proxy` measures dispatch to Bun, not native fixed JSON. Resource
GET/list and diagnostics cases execute in Rust. The HTTP bridge custom worker
uses `Bun.serve`; the in-process bridge invokes JS through Node-API without a
private HTTP listener. The Brick baseline uses Elysia. All variants use the same SQLite file, execute
COUNT plus page SQL per list request, and verify matching pagination responses.
The external loader and each server run in separate processes. Rust has one
runtime event-loop thread; oha uses two loader threads. CPU/RSS measurements in
the built-in mode refer only to the loader process.

API references: [Axum](https://docs.rs/axum/0.8.9/axum/),
[rusqlite](https://docs.rs/rusqlite/0.38.0/rusqlite/),
[oha](https://github.com/hatoo/oha).

Native callback references: [Bun Node-API](https://bun.sh/docs/runtime/node-api),
[NAPI-RS thread-safe functions](https://napi.rs/docs/concepts/threadsafe-function),
[Rust JSON Schema validator](https://docs.rs/jsonschema/0.46.10/jsonschema/).
