# @brickkit/cli

CLI and server engine for the Brick-TS framework. Mounts services,
actions, and resources as a typed HTTP API (Elysia) with OpenAPI 3.1,
Scalar/Swagger docs, request logging, and MCP routes.

You need Bun 1.2 or later.

```sh
bun add @brickkit/cli @brickkit/core
```

```ts
import { brick } from "@brickkit/core";

const app = brick({ title: "Pages API", version: "1.0.0" });
app.listen(3333);
```

## Commands

Every command except `dev` and `start` takes a required `<entry>`: a module
whose default export is a `BrickApp` that does not call `.listen()`.

```sh
brick dev [entry] [--port 4000]
brick start [entry] [--port 4000]
brick build <entry> [--outdir dist/brick] [--port <number>] [--no-aot]
brick gen openapi <entry> [--output openapi.json]
brick gen client <entry> [--output _brick/contract.ts]
brick info <entry>
```

Build the backend directly from registered services:

```ts
import { brick } from "@brickkit/core";
import { pagesService, billingService } from "./services";

const app = brick({ services: [pagesService, billingService] });
```

The typed HTTP client is available from `@brickkit/core/client`. See
`www/content/docs/(brick)/typed-client.mdx` for routing and error handling.

The `brick` binary ships in this package for local dev and inspection.
`dev` and `start` accept an optional entry and resolve the port from
`--port`, then `PORT`, then 4000:

```sh
brick dev --port 4000
brick dev src/app.ts --port 4000
brick gen openapi src/app.ts --output openapi.json
brick gen client src/app.ts
brick info src/app.ts
```

Source: <https://github.com/Chandraprakash-Darji/brick>.

## Action routes

Each action exposes exactly one route: `method` defaults to POST, and `path`
defaults to `/api/{service}/{action}` (or your configured prefix). Explicit
methods are honored regardless of the action name. A custom `path` includes
its own prefix and replaces the default path. OpenAPI describes the same
method and path, including path parameters.

To expose a read action over GET, declare `method: "GET"`. Action names beginning
with `get`, `list`, `find`, or `read` no longer add a GET alias. Custom paths no
longer expose default action aliases or an additional method. Resource CRUD
routes keep their REST methods.

## Compiler

The server compiles specialized JavaScript handlers for all resource CRUD and
custom actions at startup, pre-renders documentation, and caches OpenAPI and
architecture JSON with definition/endpoint invalidation. Health retains live
uptime and timestamps. Build a
module whose default export is a `BrickApp` into a runnable Bun server with:

```sh
brick build src/app.ts --outdir dist/brick
bun dist/brick/server.js
```

Use the same app entry as `brick gen client`. The build preserves its selected
services, prefix, docs settings, endpoints, and Elysia hooks. Keep `.listen()`
in a separate server bootstrap.

This beta branch pins Elysia `2.0.0-beta.29`. `brick build` also precompiles
Elysia's HTTP handlers with its Bun AOT plugin and removes the runtime HTTP
compiler. Use `brick build src/app.ts --no-aot` for a regular bundle.
Development and direct `brick()` calls still use runtime HTTP compilation;
both modes share the same services and Brick handlers.

## Automatic typed client with Vite

Add `brickClient` before your framework plugins. Its entry can be any module
whose default export is a `BrickApp`; construct the app without calling
`.listen()` there:

```ts
// src/api/app.ts
import { brick } from "@brickkit/core";
import { pagesService } from "./services";

export default brick({ prefix: "/v2", services: [pagesService] });
```

```ts
// vite.config.ts
import { brickClient } from "@brickkit/cli/vite";

export default defineConfig({
  plugins: [
    brickClient({ entry: "./src/api/app.ts" }),
    // TanStack Start, React, or other framework plugins
  ],
});
```

Vite creates `_brick/contract.ts` before loading the frontend and before
production builds. The prefix and selected services come from the app. Backend
edits regenerate the file; unchanged metadata does not rewrite it. There is no
separate generation command or manually maintained action list.

```ts
// src/client.ts
import { createBrickClient } from "@brickkit/core/client";
import { contract } from "../_brick/contract";

export const api = createBrickClient({
  baseUrl: "http://localhost:8085",
  contract,
});
```

The generated file contains transport types and route metadata, with no runtime
imports or backend handlers. HTTP actions are grouped by service name; dotted
action names become nested namespaces. Resources use their names at the root
and their normal REST routes. MCP-only tools are excluded. Add `_brick/` to
`.gitignore`; customize its location with `output` in the plugin options.

For TanStack Start or another embedded server, import the app from
`virtual:brick-app` in server code and forward requests to `app.fetch(request)`.
Vite tracks the entry and its dependencies for backend hot reload. Browser
imports of this server module are rejected. Add
`/// <reference types="@brickkit/cli/vite/client" />` to your Vite environment
declarations. See `examples/pages` for a complete Start integration.

Generation evaluates the app entry, so the configuration it needs to construct
the app must be available in development and at build time. Keep startup jobs
and connection-opening initialization in request handlers or your server
bootstrap, outside the app definition module. Input/output types
come from JSON transport schemas; absent schemas produce `unknown`. Unresolved
schema references and non-JSON transport types fail generation explicitly.
This integration requires Vite 8; the normal server entry point has no Vite
runtime dependency. `generateClientContract(app)` exposes the source generator
for non-Vite tooling.

## Generate a typed client without Vite

Use the standalone Bun CLI with any module whose default export is a `BrickApp`:

```sh
brick gen client src/app.ts
brick gen client src/app.ts --output frontend/src/contract.ts
```

The default output is `_brick/contract.ts`, relative to the working directory.
The app's selected services and prefix determine its contents, just as with the
Vite plugin. The command evaluates the entry without calling `.listen()`; keep
the listener in a separate server bootstrap. Vite is not required or loaded.

Repeated transport type fragments are emitted as shared `BrickSchema_*` aliases
when the declarations reduce source size. Names are derived from the emitted
shape, so runtime-only constraints such as string length bounds do not prevent
sharing. Scalars stay inline, and reference targets retain document-scoped
aliases; equivalent recursive graphs in separate documents remain separate.
This applies to both standalone and Vite generation.

Run generation before your frontend's development server, build, and type check,
and rerun after changing backend definitions. You can add a package script:

```json
{
  "scripts": {
    "gen:client": "brick gen client src/app.ts"
  }
}
```

Import the generated `contract` with `createBrickClient({ baseUrl, contract })`
as shown above. The command creates parent directories and leaves an unchanged
contract file untouched. Add the generated output to `.gitignore`.

## Coordinate backend and frontend development

For a separate frontend tool, generate the contract before its compiler starts:

```sh
brick dev src/app.ts --client frontend/src/contract.ts --frontend 'bun run --cwd frontend dev'
```

The app entry must default-export a BrickApp without calling `.listen()`.
Brick generates the initial contract, starts the frontend command once, and
restarts the backend on edits. Imported local dependencies outside the entry's
directory are watched too. Changes coalesce before restart; every restart evaluates
the app in a fresh process and generates the contract before starting the server.
Generation failures preserve the previous contract and print the error. The next
valid edit retries. Stopping `brick dev` stops its backend and frontend children.
`--client` also works without `--frontend` if another process owns the frontend.

For an embedded Vite app such as Pages, keep using `brickClient` in `vite.config.ts`.
Vite owns backend loading and frontend startup in that setup. It generates before
startup and production compilation, reloads the app definition graph, including imported service instances, and reports generation errors through its terminal and browser overlay.
A valid edit regenerates the contract after an error. Both integrations atomically
replace changed contracts and preserve unchanged files, so implementation-only
edits do not trigger frontend contract updates. Generated files are excluded from
regeneration triggers.

For non-Vite production builds and type checks, run `brick gen client` as the first
command in the build or typecheck script. It uses the same generator and atomic
writer as development. Keep startup jobs and listeners outside the app definition,
since all generation paths evaluate the entry.
