# @elregaldo/cli

CLI and server engine for the Brick-TS framework. Mounts services,
actions, and resources as a typed HTTP API (Elysia) with OpenAPI 3.1,
Scalar/Swagger docs, request logging, and MCP routes.

```sh
bun add @elregaldo/cli @elregaldo/core
```

```ts
import { createBrickServer } from "@elregaldo/cli";

const app = createBrickServer({ title: "Pages API", version: "1.0.0" });
app.listen(3333);
```

The `brick` binary ships in this package for local dev and inspection:

```sh
brick dev --port 4000
brick gen openapi --output openapi.json
brick info
```

Source: <https://github.com/brick-org/brick>.

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
