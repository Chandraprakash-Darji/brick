# @brickkit/core

The Effect-native kernel of Brick. Declare typed actions once; Brick serves them
as HTTP endpoints (with OpenAPI), RPC methods, and MCP tools.

```ts
import { Brick } from "@brickkit/core";
import { NotFound } from "@brickkit/core/contracts";
import { Effect, Layer, Schema } from "effect";

const GetUser = Brick.action("getUser", "/api/users/getUser", {
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
  errors: [NotFound],
});

// Handlers are Effects: failures must be declared in `errors`, and any
// service they require must be provided by the app's `layer`.
const getUser = GetUser(({ id }) =>
  id === "usr_42"
    ? Effect.succeed({ id, name: "Ada" })
    : Effect.fail(new NotFound({ message: "User not found" })),
);

const users = Brick.service("users", { actions: { getUser } });
export const app = Brick.app({ services: [users], layer: Layer.empty });

Bun.serve({ port: 3000, fetch: app.fetch });
```

## API

| Export                                                        | Purpose                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Brick.action(name, path, schemas)`                           | Contract + handler factory: input, output, declared errors, optional `mcp`, `title`, `description` |
| `Brick.endpoint(name, method, path, schemas)`                 | Like `action`, with typed `params`, `query`, `payload`, `headers`                                  |
| `Brick.service(name, { actions })`                            | Groups actions into an HTTP API group                                                              |
| `Brick.app({ services, layer, transports?, routes?, docs? })` | Compiles services into one scoped application                                                      |
| `Brick.route(method, path, effect)`                           | Raw HTTP route outside the action contract                                                         |
| `Brick.rpcGroup(actions)`                                     | Effect RPC group for service-to-service calls                                                      |
| `secret`, `envSource`, ...                                    | Typed secrets, validated at startup                                                                |

`Brick.app` returns `{ fetch, ready, dispose, layer, api, openApi() }`.
`fetch` starts the application lazily; `dispose` interrupts in-flight
requests and releases every scoped resource once.

## Typed errors

Errors are `Schema.TaggedError` classes, so they are values in the type
system, carry their HTTP status, and cross the wire with their type intact.
`@brickkit/core/contracts` exports `BadRequest`, `Unauthorized`, `Forbidden`,
`NotFound`, `Conflict`, and `InternalServerError`. Define your own:

```ts
export class SlugTaken extends Schema.TaggedError<SlugTaken>()(
  "SlugTaken",
  { slug: Schema.String },
  { httpApiStatus: 409 },
) {}
```

Failing with an error that the action did not declare is a compile error.
Unexpected failures are defects and are returned as a redacted 500.

## Dependencies

Provide services through the app's `layer`. An action that requires a service
the layer does not supply does not type-check.

## Transports

```ts
import { McpProtocol } from "effect/ai";

Brick.app({
  services: [users],
  layer,
  transports: {
    rpc: { path: "/rpc" },
    mcp: {
      name: "users",
      version: "1.0.0",
      path: "/mcp",
      protocols: [McpProtocol.v2025_11_25],
    },
  },
  docs: { path: "/reference" },
});
```

Only actions with `expose: "mcp"` or `expose: "both"` are exposed as MCP tools. The MCP
options are those of Effect's `McpServer.layerHttp`.

## Entry points

| Import                     | Contents                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| `@brickkit/core`           | `Brick`, `isNativeBrickApp`, secrets                                    |
| `@brickkit/core/contracts` | `action`, `endpoint`, and standard errors; browser-safe, no server code |
| `@brickkit/core/pg`        | Drizzle `pg-core` re-exports, for a single Drizzle copy                 |
