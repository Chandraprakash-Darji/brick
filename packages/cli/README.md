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
