# @brickkit/cli

CLI and server engine for the Brick-TS framework. Mounts services,
actions, and resources as a typed HTTP API (Elysia) with OpenAPI 3.1,
Scalar/Swagger docs, request logging, and MCP routes.

```sh
bun add @brickkit/cli @brickkit/core
```

```ts
import { brick } from "@brickkit/cli";

const app = brick({ title: "Pages API", version: "1.0.0" });
app.listen(3333);
```

Build the backend directly from registered services:

```ts
import { brick } from "@brickkit/cli";
import { pagesService, billingService } from "./services";

const app = brick({ services: [pagesService, billingService] });
```

The typed HTTP client is available from `@brickkit/core/client`. See
`www/content/docs/(brick)/typed-client.mdx` for routing and error handling.

The `brick` binary ships in this package for local dev and inspection:

```sh
brick dev --port 4000
brick gen openapi --output openapi.json
brick gen client src/app.ts
brick info
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
definitions module into a runnable Bun server with:

```sh
brick build src/definitions.ts --outdir dist/brick
bun dist/brick/server.js
```

See [the compilation plan and artifact contract](COMPILER.md) for implemented
stages, limitations and the next optimizations.

## Automatic typed client with Vite

Add `brickClient` before your framework plugins. Its entry can be any module
whose default export is a `BrickApp`; construct the app without calling
`.listen()` there:

```ts
// src/api/app.ts
import { brick } from "@brickkit/cli";
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
