# @brickkit/core

Services, actions, resources, and databases for the Brick-TS framework. You define typed services with TypeBox schemas, mount them with `brick()`, and get an Elysia HTTP server with OpenAPI output and a typed client.

You need Bun 1.2 or later. Bun-only APIs are lazy-loaded, so the package imports cleanly under strict Node ESM too.

```sh
bun add @brickkit/core
```

## Define a service

Create a service, register an action on it, and serve it. Each action exposes one route: `POST /api/{service}/{action}` by default.

```ts
import { brick, defineAction, defineService } from "@brickkit/core";

const healthService = defineService("system");
const ping = defineAction({
  name: "ping",
  execute: async () => ({ status: "ok" }),
});
healthService.action(ping);

const app = brick({ services: [healthService] });
app.listen(4000);
```

Set `method: "GET"` on the action config to serve reads over GET, or `path` to replace the default route. Add `input` and `output` TypeBox schemas to validate at the boundary. Add `authorize` to require a user; without it the action is public. To call an action in process with the same pipeline, use `action.run(input, ctx)` or `service.getAction("ping")`.

`brick()` also accepts `prefix`, `title`, and `version`. `generateOpenApiSpec({ services, prefix })` returns the OpenAPI 3.1 document without starting a server.

## Exports

| Path                    | What it holds                                                   |
| ----------------------- | --------------------------------------------------------------- |
| `@brickkit/core`        | `brick`, `defineService`, `defineAction`, `defineDatabase`, MCP |
| `@brickkit/core/client` | `createBrickClient`, the Eden-style typed browser client        |
| `@brickkit/core/pg`     | Postgres Drizzle table helpers such as `pgTable`                |

Databases use Drizzle tables through `defineDatabase({ engine, tables, url })` with `"sqlite"` or `"postgres"` engines. Database setup is documented in `DATABASES.md`.

```sh
bun add @brickkit/core drizzle-orm postgres
```

```ts
import { defineDatabase } from "@brickkit/core";
import { pgTable, text } from "@brickkit/core/pg";

const pages = pgTable("pages", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

export const db = defineDatabase({
  engine: "postgres",
  tables: { pages },
  url: process.env.DATABASE_URL!,
});
```

## Typed client

`@brickkit/core/client` (also re-exported from the package root) offers an Eden-style HTTP client inferred from your contract type — no OpenAPI codegen:

With the Brick Vite plugin configured for your default-exported app, Vite creates `_brick/contract.ts` automatically:

```ts
import { createBrickClient } from "@brickkit/core/client";
import { contract } from "../_brick/contract";

const api = createBrickClient({ baseUrl: "http://localhost:4000", contract });
const pages = await api.page.list({ limit: 10 });
```

The generated contract contains browser-safe route metadata and inferred input/output/error types. It honors custom action paths and methods, encodes path parameters, and removes them from the remaining payload. No backend handlers are bundled. See the CLI README and `www/content/docs/(brick)/typed-client.mdx` for Vite setup and error handling.

## MCP tools

Define tools like actions, with typed input/output schemas and inline metadata:

```ts
import {
  defineService,
  createMcpRegistry,
  createMcpHandler,
  t,
} from "@brickkit/core";

const crm = defineService("crm");
const whoami = crm.tool({
  name: "crm_whoami",
  title: "View Connected CRM Account",
  annotations: { readOnlyHint: true },
  input: t.Object({}),
  output: t.String(),
  authorize: ({ user }) => !!user?.id,
  execute: ({ ctx }) => ctx.user.id,
});

const registry = createMcpRegistry({ services: [crm] });
registry.listTools();
await registry.callTool("crm_whoami", {}, { user: { id: "user_1" } });

const handleMcp = createMcpHandler({
  registry,
  serverInfo: { name: "crm", version: "1.0.0" },
});
// After your app authenticates a request:
// return handleMcp(request, { user: { id: verifiedSubject } });
```

Tools use action validation, authorization, and service context. They are stored separately from HTTP actions and stay out of routes and OpenAPI by default, including when their service is passed to `brick()`. Add `http: true` to a tool definition, or register it with `crm.action(whoami)`, to expose it over HTTP as well.

The registry accepts `services` and/or an explicit `tools` array, rejects duplicate names, and reads annotations directly from definitions. The handler is a stateless POST JSON-RPC helper for initialize, ping, tools/list, and tools/call; notifications receive an empty 202 response. Authentication and mounting remain in your app. Its default protocol version is `2025-06-18`, following the [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

Source: <https://github.com/Chandraprakash-Darji/brick>.
