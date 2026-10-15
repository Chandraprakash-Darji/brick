# Verify Effect-native integration

These checks exercise the replacement dependencies before migrating Brick's public API.
They are isolated from the workspace dependency pins.

```sh
bun install --cwd scripts/effect-native --frozen-lockfile
bun run effect:check
```

The PostgreSQL test requires an isolated database with permission to create tables.
It adds better-auth users and sessions. It does not delete existing tables or rows.

```sh
BRICK_SPIKE_DATABASE_URL=postgresql://localhost/brick_effect_test bun run effect:check
```

Without that variable, the PostgreSQL test is explicitly skipped. A skipped database
test does not verify PostgreSQL or better-auth compatibility.

The checks cover native HTTP input/output and declared error decoding, exact handler
requirements and negative TypeScript fixtures, SQLite transactions, PostgreSQL
transactions alongside better-auth sessions, RPC over a real HTTP listener, and MCP
tool discovery and calls through HTTP authentication middleware. The MCP check uses
protocol `2025-11-25` and a fixed test bearer token. Production OAuth and propagation
of authenticated request services still need integration tests.

Drizzle `1.0.0-rc.4` fails to import with Effect `4.0.4` because it still calls
`Schema.TaggedErrorClass`. These checks pin `1.0.0-rc.5-5935859`, which imports with
Effect `4.0.4`. The Drizzle constructor also changed from `drizzle(pool, options)` to
`drizzle({ client: pool })`. The schema passed to better-auth's adapter stays explicit.

Passing these checks does not mean the framework migration is complete. At the
time of writing, the existing public API, CLI, CRUD plugin, and pages
application still use the previous runtime. (Update: the migration has since
landed on `feat/effect-native-migration`; the checks remain as regression
coverage.)
