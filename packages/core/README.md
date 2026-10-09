# @brickkit/core

Core engine primitives for the Brick-TS framework: typed services, actions,
resources, databases (SQLite/Postgres via Drizzle), secrets, and pub/sub —
all validated with TypeBox and runnable on Bun or Node.

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

Bun-only APIs are lazy-loaded, so the package imports cleanly under
strict Node ESM too. Source: <https://github.com/Chandraprakash-Darji/brick>.

## Typed client

`@brickkit/core/client` (also re-exported from the package root) offers an
Eden-style HTTP client inferred from your contract type — no OpenAPI codegen:

```ts
import { createBrickClient } from "@brickkit/core/client";
import type { AppServer } from "./server"; // type-only: never bundled

const api = createBrickClient<AppServer>({ baseUrl: "http://localhost:4000" });
const pages = await api.page.list({ limit: 10 });
```

Custom actions use their configured `path` and `method` when you pass the runtime
`contract`. Paths are absolute server paths, including the prefix. `:parameter`
segments are URL-encoded from input and removed from the remaining payload.
GET and DELETE send remaining input as query parameters; POST, PUT, and PATCH
send JSON. The default custom action method is POST.

Missing path parameters reject before sending a request. Without the runtime
contract, the client uses its conventional resource and action routes.

See `www/content/docs/(brick)/typed-client.mdx` for the contract-first setup
(`defineAppContract` + `brickFromContract`), routing, and error handling.

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

Tools use action validation, authorization, and service context. They are stored
separately from HTTP actions and stay out of routes and OpenAPI by default,
including when a service or tool is referenced in `brickFromContract`. Add
`http: true` to a tool definition, or register it with `crm.action(whoami)`, to
expose it over HTTP as well.

The registry accepts `services` and/or an explicit `tools` array, rejects duplicate
names, and reads annotations directly from definitions. The handler is a
stateless POST JSON-RPC helper for initialize, ping, tools/list, and tools/call;
notifications receive an empty 202 response. Authentication and mounting remain
in your app. Its default protocol version is `2025-06-18`, following the
[MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
