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

## Vite integration

Use `@brickkit/cli/vite` with an entry module whose default export is a
`BrickApp`. The filename is unrestricted; the entry constructs the app without
calling `.listen()`:

```ts
// src/api/app.ts
import { brick } from "@brickkit/cli";
import { pagesService } from "./services";

export default brick({ services: [pagesService] });
```

```ts
// vite.config.ts
import { brickClient } from "@brickkit/cli/vite";

export default defineConfig({
  plugins: [brickClient({ entry: "./src/api/app.ts" })],
});
```

Server code can import the app from `virtual:brick-app`; Vite tracks the entry
and its dependencies for hot reload. Browser imports of this server module are
rejected. Add `/// <reference types="@brickkit/cli/vite/client" />` to your
Vite environment declarations for its TypeScript type. This integration uses
Vite 8 and is isolated from the normal server entry point.
