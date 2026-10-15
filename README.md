<div align="center">
  <picture>
    <source srcset="./banner-dark.svg" media="(prefers-color-scheme: dark)"/>
    <source srcset="./banner-light.svg" media="(prefers-color-scheme: light)"/>
    <img src="./banner-light.svg" alt="Brick logo" width="160"/>
  </picture>

[![npm](https://img.shields.io/npm/dm/@brickkit/core?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@brickkit/core)
[![npm version](https://img.shields.io/npm/v/@brickkit/core.svg?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@brickkit/core)
[![GitHub stars](https://img.shields.io/github/stars/Chandraprakash-Darji/brick?style=flat&colorA=000000&colorB=000000)](https://github.com/Chandraprakash-Darji/brick/stargazers)

  <p>
    <a href="https://github.com/Chandraprakash-Darji/brick/issues">Issues</a>
    ·
    <a href="./CONTRIBUTING.md">Contributing</a>
    ·
    <a href="https://github.com/Chandraprakash-Darji/brick/releases">Releases</a>
  </p>
</div>

# Brick-TS

Brick-TS is an Effect-native TypeScript backend framework on Bun. You declare typed actions once, and Brick serves them as HTTP endpoints with OpenAPI, as RPC methods, and as MCP tools. Errors are typed values, dependencies are checked by the compiler, and resources are scoped.

The framework is built on Effect 4: `effect/http-api` for HTTP, `effect/rpc` for RPC, `effect/ai` for MCP, and Drizzle ORM through its Effect drivers. The pages example adds Better Auth and Postgres.

## Install

You need Bun 1.2 or later.

```sh
bun add @brickkit/core @brickkit/crud @brickkit/client effect
bun add -d @brickkit/cli
```

## Build a minimal API

```ts
import { Brick } from "@brickkit/core";
import { NotFound } from "@brickkit/core/contracts";
import { Effect, Layer, Schema } from "effect";

const GetUser = Brick.action("getUser", "/api/users/getUser", {
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
  errors: [NotFound],
});
const getUser = GetUser(({ id }) =>
  id === "usr_42"
    ? Effect.succeed({ id, name: "Ada" })
    : Effect.fail(new NotFound({ message: "User not found" })),
);

const users = Brick.service("users", { actions: { getUser } });
export default Brick.app({ services: [users], layer: Layer.empty });
```

```sh
brick dev src/app.ts
brick gen openapi src/app.ts --output openapi.json
brick info src/app.ts
```

This serves `POST /api/users/getUser`. The entry module must default-export the app and must not start a listener; `brick dev` and `brick start` do that.

## Packages

| Package            | Directory          | What it holds                                                                               |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------- |
| `@brickkit/core`   | `packages/core/`   | `Brick` actions, services, apps, typed errors, secrets.                                     |
| `@brickkit/crud`   | `packages/crud/`   | CRUD contracts and handlers for Drizzle tables, with field policies, hooks, and typed rows. |
| `@brickkit/client` | `packages/client/` | Promise and Effect clients typed from the same contract.                                    |
| `@brickkit/cli`    | `packages/cli/`    | The `brick` binary: `dev`, `start`, `build`, `gen`, `info`, plus the Vite client plugin.    |

The full app is in `examples/pages/`. It mounts the API in process with TanStack Start. Smaller examples are `examples/showcase` and `examples/extensions`. The docs site is in `www/`.

The long-term plans for this Effect-native direction are in `docs/effect/`.

## Develop and test

```sh
bun install
bun test ./packages
bun run pages:dev
```

`bun test ./packages` runs the framework tests without Postgres. `bun run pages:dev` builds the framework and starts the combined web and API server on port 5174. Rerun it after you change framework code.

The pages suite needs Postgres. It is documented in `examples/pages/README.md`.

```sh
bun run pages:typecheck
TEST_DATABASE_URL=postgresql://localhost:5432/drafton_test bun run pages:test
```

Run the full gate before you push:

```sh
bun run check
```

`bun run check` runs lint, format check, build, typecheck, and tests. Each package also has `lint`, `lint:fix`, `format`, and `format:check`. Shared config lives in `.oxlintrc.json` and `.oxfmtrc.json`.

## Release

Releases run from a clean, up-to-date `main` checkout:

```sh
bun run release patch
```

The script in `scripts/release.ts` bumps all four packages to one version and pushes one `v<version>` tag. The `publish-npm.yml` workflow publishes the packages and creates the GitHub release. `dry_run` previews the bump and validates tarballs without publishing. Beta releases run from the `beta` branch.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=Chandraprakash-Darji/brick&type=date&legend=top-left)](https://www.star-history.com/?repos=Chandraprakash-Darji%2Fbrick&type=date&legend=top-left)

## Contribute

Read `CONTRIBUTING.md` for setup, checks, and hook behavior. Small starter tasks carry the `good first issue` label. The project is MIT licensed.
