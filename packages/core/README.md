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

## Tracing

Brick records HTTP, action, and RPC spans through `@opentelemetry/api`. Tracing
is off by default. Turn it on per app with the `telemetry` option, and register
an OpenTelemetry tracer provider so the spans have somewhere to go:

```ts
import { brick } from "@brickkit/core";

const app = brick({ services: [pagesService], telemetry: true });
```

Each request becomes a server span. Each action, remote call, and SQL statement
made during it becomes a child span. SQLite statements are timed at the
`bun:sqlite` driver, and postgres.js statements at the query itself. Failures
are recorded on the span that produced them: server faults (5xx) mark the span
as errored with an exception event, while client errors (4xx) only add
`brick.error.code`. Without a registered provider the spans are no-ops.

With a W3C trace context propagator registered, requests continue a caller's
trace from its `traceparent` header, and the response carries `traceparent`
back. Without an `x-trace-id` header, Brick returns the request's trace id as
`x-trace-id`. Statement text is recorded as `db.statement`; bound parameter
values are not.

Routes registered directly on the app, such as an auth handler mounted with
`app.all()`, sit outside actions and endpoints. Wrap their handlers with
`traceRoute(route, handler)` to give them a server span. The handler receives
`request`, `headers`, `set`, `params`, and `query`; read the body from
`request`. `traceRoute` records whenever a tracer provider is registered.

```ts
import { traceRoute } from "@brickkit/core";

app.all(
  "/api/auth/*",
  traceRoute("/api/auth/*", ({ request }) => auth.handler(request)),
);
```

`brick dev` registers a provider and sends the spans to its dashboard, so apps
there need `telemetry: true` too.

## Effect APIs

`@brickkit/core` keeps the existing synchronous declarations and Promise APIs.
`@brickkit/core/effect` provides Effect callbacks for services, actions, tools,
resource plugins, endpoints, and application lifecycle hooks. Declarations and
plugin setup stay synchronous so the compiler can inspect them and plugin
installation can roll back failed declarations.

```ts
import { Context, Effect, Layer } from "effect";
import { brick, defineService, t } from "@brickkit/core/effect";

class Greeting extends Context.Service<Greeting, { text: string }>()(
  "Greeting",
) {}

const service = defineService("greetings", {
  context: () => Effect.map(Greeting, ({ text }) => ({ greeting: text })),
  lifecycle: {
    onInit: () => Effect.void,
    onDestroy: () => Effect.void,
  },
});

const hello = service.action({
  name: "hello",
  output: t.String(),
  authorize: () => Effect.succeed(true),
  execute: ({ ctx }) => Effect.succeed(ctx.greeting),
});

const app = brick({
  services: [service],
  layer: Layer.succeed(Greeting, { text: "Hello" }),
  endpoints: [
    {
      method: "GET",
      path: "/greeting",
      handler: () => Effect.map(Greeting, ({ text }) => ({ text })),
    },
  ],
});

await app.initialize();
await hello.run(); // "Hello"
await app.handle(new Request("http://localhost/greeting"));
await app.dispose();
```

The app acquires its Layer once and shares it across service contexts, actions,
tools, resource policies, plugin endpoints, and HTTP routes. Initialization runs
before the first HTTP request or server startup. `initialize()` also lets scripts
initialize explicitly before direct action or tool calls. `dispose()` runs service
destruction hooks, releases the Layer, and releases database handles — closing
the ones no remaining app uses. Injected database clients remain owned by their
callers. Services may be shared across apps; the newest live binding wins for
direct calls, and disposing an app restores the previous binding.

The app exposes `initializeEffect`, `disposeEffect`, `handleEffect(request)`, and
`listenEffect(port)` for Effect composition. The normal `.handle()`, `.listen()`,
and `.stop()` methods remain available. HTTP request cancellation interrupts
native callbacks and runs their finalizers.

Actions and tools expose lazy `executeEffect(params)`, including context
resolution, input validation, authorization, execution, and output validation.
Calling an action, `.run`, or `.execute` returns a Promise. Native action
requirements remain in the Effect type; provide dependencies with `Effect.provide`
when composing outside an app. Service context resolution also exposes
`resolveContextEffect`. Resource plugin and CRUD callbacks inherit that caller's
runtime across the Promise-based database code.

Use `service.tool` for native tools. `createMcpRegistry` retains the MCP Promise
interface and adds `callToolEffect`. `createServiceProxy` returns Effects for local
RPC calls and preserves the caller's Layer. Remote dispatch is not implemented.

Use `defineServicePlugin` and `defineResourcePlugin` from the Effect entrypoint
for native `routes.action` and `routes.endpoint` callbacks. `defineResource` and
`service.resource` share the existing resource identity and plugin host.
For CRUD policies, hooks, SQL scopes, and field scrubbers, use `crud` from
`@brickkit/crud/effect`.

`Effect.fail` preserves failure values at the Promise boundary. Use
`ActionExecutionError` for a specific HTTP status. Throwing `error` helpers also
work. Action errors include framework validation and context errors; service,
CRUD, and dynamic MCP failure types remain broad because plugins and providers
can reject arbitrary values. Dynamic registration does not prove at compile time
that an application's Layer supplies every registered callback's dependencies.
The framework uses Effect 4.

## TanStack Query options

Install `@tanstack/query-core` v5 alongside your framework's TanStack Query package.
Import the browser entry and the generated contract:

```tsx
import { createBrickQueryClient } from "@brickkit/core/tanstack-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contract } from "./_brick/contract";

const api = createBrickQueryClient({
  baseUrl: "https://api.example.com",
  contract,
});

function Pages() {
  const queryClient = useQueryClient();
  const pages = useQuery({
    ...api.page.list.queryOptions({ input: { limit: 20 } }),
    staleTime: 30_000,
    select: (result) => result.items,
  });
  const create = useMutation({
    ...api.page.create.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: api.page.list.queryKey() }),
  });
  // Render pages.data and call create.mutate with the action's input.
}
```

Direct calls such as `api.page.list(input)` still work. Both helpers are available
on every action. Choose them by how you use the action, independently of its HTTP
method. A POST query still sends POST; custom routes, plugin actions, and encoded
path parameters use the generated metadata.

`queryOptions({ input, request })` returns a typed `queryKey` and `queryFn`.
Spread native options such as `placeholderData`, `select`, and `staleTime` beside
those properties. `request` accepts the ordinary client's headers, signal, and
timeout. Query cancellation reaches fetch, and request cancellation also remains
active. `mutationOptions({ request })` returns `mutationKey` and `mutationFn`;
mutation variables are the action input.

`queryKey({ input })` addresses one input; `queryKey()` matches all inputs for the
action when passed to `invalidateQueries`. Keys include the server URL, prefix,
namespace path, contract method and route identity, and input. Headers are not part of the key. Clear or partition
your QueryClient cache when the authenticated user changes.

The same options work with `queryClient.fetchQuery`, `prefetchQuery`, and
`ensureQueryData`. For example, a TanStack Router loader can return
`context.queryClient.ensureQueryData(api.page.get.queryOptions({ input: { id: params.id } }))`.
Keys returned by `queryOptions` and input-specific `queryKey` calls also infer the
cached output type in `getQueryData`.

For TanStack DB, pass the options into `queryCollectionOptions` and supply your
own `queryClient`, `getKey`, and any `select` needed to turn a paginated response
into rows. Collection identity, pagination, optimistic writes, and synchronization
after mutations remain application responsibilities. The Pages editor demonstrates
standard Query mutations plus an explicit collection refetch for other collection
consumers.
