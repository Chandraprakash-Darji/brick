# Using brickc plans from Bun

Option A now compiles a versioned JSON execution artifact before the server
starts. Rust runs at build/dev time; requests execute in Bun.

## Build and run

From this repository:

```sh
bun run build:compiler
export BRICKC="$PWD/native/brickc/target/release/brickc"
bun packages/cli/src/bin.ts build path/to/app.ts
bun packages/cli/src/bin.ts start path/to/app.ts
```

For the installed CLI, use `brick build app.ts` and `brick start app.ts`.
Install `brickc` on PATH or set `BRICKC` to its absolute executable path.
`brick dev app.ts` compiles before listening. As with the existing runner,
restart the process after changing registrations; this does not add a watcher.
`brick build --output file.json` and `brick start --plans file.json` support
custom artifact paths. The default is `.brick/plans.json`.
The entry module must register services without starting its own server.

Production needs the entry module and artifact; it does not need Rust or
Cargo. A missing, incompatible, or stale artifact fails startup. Staleness
checks compare the current structural manifest with the compiler input.
Changes only to TypeScript callbacks do not require recompilation of SQL.

Programmatic usage:

```ts
import { compilePlans, loadPlans, createBrickServer } from "@elregaldo/cli";

// Build/dev time:
await compilePlans(services, { output: ".brick/plans.json" });

// Production:
const plans = await loadPlans(".brick/plans.json");
const app = createBrickServer({ services, plans });
app.listen(4000);
```

## Current execution scope

The v1 runtime artifact contains resource lookup SQL using the physical table
and primary-key column names. Bun SQLite prepares each statement at startup.
Lookups bind the ID and decode the returned columns through their Drizzle
column decoders, preserving logical field names, booleans, JSON and dates.

The existing resource action still performs input/output validation, ownership
checks, errors and lifecycle hooks. Its read helper uses the installed lookup,
so get actions and internal reads during create/update/delete use it. Statements
are keyed by resource plan and database instance; a context hook that changes
the database continues to use the normal adapter for that database.

This first version requires the resource idField to refer to the table primary
key on SQLite. Other database adapters continue through Drizzle. Lists (search,
filters, cursor pagination, counts) and write statements still use their current
implementation. Elysia still mounts the routes and TypeScript executes custom
actions. This is the first runtime consumer of brickc artifacts, not a complete
native request engine. The compiler's educational dump-plan SQL is separate
from the new executable artifact (`brickc compile manifest.json`).

## Benchmarks

```sh
# Current cached-Drizzle runtime vs compiled lookups, with alternating order:
bun run bench:compiled

# Existing HTTP matrix with compiled lookups:
bun bench/http.ts --smoke --compiled
```

The paired benchmark checks equal responses, warms both servers, and records
five trials per variant at concurrency 16 and 20,000 requests per trial. It
writes raw results and medians under `bench/results/`. The built-in loader runs
in the same process as the servers, so these are local closed-loop comparisons,
not production capacity measurements. No-op custom actions do not execute a
resource query and do not benefit from this SQL optimization.

For the experimental native HTTP listener and Rust resource reads, see
[brick-http](../brick-http/README.md) and use `--runtime rust` when building and
starting the application. The Bun execution path documented above remains the
default.
