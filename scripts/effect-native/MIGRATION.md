# Effect-native migration

> Status: complete. The public runtime, CLI, CRUD plugin, and pages
> application run on the Effect-native implementation in `packages/`.
> The notes below describe the migration as it happened.

The target is the Effect-only framework described in the local
`docs/effect/EFFECT_NATIVE_PLAN.md`. The current public runtime remains the 0.4
implementation until its callers have been migrated and the replacement passes the
same behavior checks.

## Verification units

1. Establish the existing baseline and prove replacement dependencies in isolation.
   `bun run check` passes 282 existing tests. `bun run effect:check` runs strict type
   fixtures and real native transport/database checks. PostgreSQL needs the explicit
   test database URL described in the README.
2. Build the replacement kernel around Effect Schema contracts, exact handler errors
   and requirements, immutable service definitions, native HTTP, scoped app ownership,
   and a browser-safe API contract. Prove declared errors preserve their classes and
   individual HTTP statuses. Prove missing dependencies and undeclared failures are
   compilation errors. Prove independent apps and request cancellation.
3. Migrate the database definitions and CRUD policy/query/hook behavior to the Effect
   drivers. Preserve field rules, SQL scoping, limits, generated fields, and transaction
   behavior. Migrate the pages resource and custom actions.
4. Move the browser client, compiler, CLI, and Vite integration to Schema contracts and
   the native runtime. Verify a production pages build and its HTTP behavior.
5. Integrate native RPC and MCP with shared authorization and request identity. Verify
   the same business errors and policies locally and remotely. The current transport
   spikes prove native framing and bearer admission, not production OAuth.
6. Delete the old Promise authoring API, TypeBox, Elysia, ambient runtime bindings, and
   `/effect` adapters after all repository callers have moved. Update the docs and run
   the full check plus pages tests/typecheck/build. Publishing and deployment are
   separate actions.

## Decisions supported by the first checks

The database dependency in the saved plan needs revision. Drizzle
`1.0.0-rc.4` still calls the removed `Schema.TaggedErrorClass` API and fails at import
time with Effect `4.0.4`. The pinned `1.0.0-rc.5-5935859` snapshot passes SQLite and
PostgreSQL queries and transactions. A real better-auth sign-in and session lookup
works alongside the native PostgreSQL driver using a separate Promise-based pool.
The constructor is `drizzle({ client: pool })` in that snapshot.

Use immutable service values rather than registration on a class. Calling a static
`Pages.action(...)` from another module cannot grow `typeof Pages` to include the
action or its requirements. An explicit final service value can retain both. Effect
`Context.Service` classes still define repositories and other dependencies.

Native HTTP builder layers distinguish startup services from services supplied per
request. Capture repository services when constructing handlers and leave identity
with request middleware. Providing an ordinary Layer does not remove an unresolved
`HttpRouter.Request<"Requires", R>` marker.

The native MCP HTTP adapter requires an explicit protocol list. The first wire check
uses `McpProtocol.v2025_11_25`, including initialization and session negotiation.

## Remaining gates

The dependency and transport spikes alone do not complete the migration. In
particular, the public API, CRUD, CLI, compiler, browser bundle, pages application,
production OAuth, topology configuration, and shared authorization across transports
must all pass their integration checks before deleting the previous runtime.
