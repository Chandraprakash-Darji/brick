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

Brick-TS is a TypeScript backend framework on Bun. You define services with validated actions, mount them with `brick()`, and get an Elysia HTTP server with OpenAPI output and a typed client.

The framework runs on Bun, Elysia, TypeBox, and Drizzle ORM. The pages example adds Better Auth and Postgres.

## Install

You need Bun 1.2 or later.

```sh
bun add @brickkit/core @brickkit/cli @brickkit/crud
```

## Build a minimal API

Define a service, mount it, and start the server.

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

This serves `POST /api/system/ping`.

Inspect the same app without starting it:

```sh
brick gen openapi src/app.ts --output openapi.json
brick info src/app.ts
```

The entry module must default-export the `BrickApp` and must not call `.listen()` inside it. Keep the listener in a separate bootstrap file. The CLI reference is in `packages/cli/README.md`.

## Packages

| Package          | Directory        | What it holds                                                                                |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `@brickkit/core` | `packages/core/` | Services, actions, the `brick()` server, and the typed client at `@brickkit/core/client`.    |
| `@brickkit/crud` | `packages/crud/` | Opt-in CRUD plugin with field policies, filtering, and hooks.                                |
| `@brickkit/cli`  | `packages/cli/`  | The `brick` binary: `dev`, `start`, `build`, `gen`, and `info`, plus the Vite client plugin. |

The full app is in `examples/pages/`. It mounts the API in process with TanStack Start and uses workspace packages directly. The docs site is in `www/`, with content in `www/content/docs`.

## Develop and test

```sh
bun install
bun test packages
bun run pages:dev
```

`bun test packages` runs the framework tests without Postgres. `bun run pages:dev` builds the framework and starts the combined web and API server on port 5174. Rerun it after you change framework code.

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

The script in `scripts/release.ts` bumps all three packages to one version and pushes one `v<version>` tag. The `publish-npm.yml` workflow publishes the packages and creates the GitHub release. `dry_run` previews the bump and validates tarballs without publishing. Beta releases run from the `beta` branch.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=Chandraprakash-Darji/brick&type=date&legend=top-left)](https://www.star-history.com/?repos=Chandraprakash-Darji%2Fbrick&type=date&legend=top-left)

## Contribute

Read `CONTRIBUTING.md` for setup, checks, and hook behavior. Small starter tasks carry the `good first issue` label. The project is MIT licensed.
