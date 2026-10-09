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

Prefer a single source of truth? Define the client contract once and derive
the server from it — no separate `services` list:

```ts
import { brickFromContract } from "@brickkit/cli";
import { defineAppContract } from "@brickkit/core/client";

export const contract = defineAppContract({
  page: pagesResource,
  billing: { charge: chargeAction },
});
export type AppServer = typeof contract;

const app = brickFromContract(contract);
```

Frontends then call it fully typed via `createBrickClient<AppServer>()`
(`@brickkit/core/client`, type-only import). See
`www/content/docs/(brick)/typed-client.mdx` for routing, error handling, and
options.

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
