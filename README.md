# Brick-TS

_High-Throughput, Logical-Monolith / Physical-Microservices TypeScript Platform_

Powered by **Bun (Rust core)** + **Elysia (AOT routing)** + **Better Auth** + **Drizzle ORM**.

Install the public packages:

```sh
bun add @brickkit/core @brickkit/cli
```

To release new versions from a clean, up-to-date `main` checkout:

```sh
bun run release patch
```

The release script bumps versions, builds and tests the packages, then pushes
`v<version>`, with core and CLI sharing the same version. GitHub Actions publishes
both packages to npm, then creates one GitHub release with notes grouped by package. The
**Publish to npm** workflow also supports manual dispatch and a dry-run option.

For token-free publishing, configure a trusted publisher in each npm package's
settings: owner `Chandraprakash-Darji`, repository `brick`, workflow `publish-npm.yml`, with
`npm publish` allowed. The initial publish can use the repository's `NPM_TOKEN`
secret with write access to the `@brickkit` scope.

For local development, run `bun install`; it installs Lefthook's Git hooks.
Before committing, the hooks check staged whitespace, formatting with Oxfmt,
and lint with Oxlint. Package, example, or benchmark changes also run tests.
Before pushing, the hooks check repository formatting and lint, build both
packages, check package and benchmark types, and run all tests.
Website changes also run its lint and type checks. The website is part of the
Bun workspace, so the root `bun install` manages all dependencies with one
`bun.lock`.

Run `bun run check` for the package checks, or
`bunx --no-install lefthook run pre-push --all-files` to include website checks.

Every package, example, and the website provides `bun run lint`,
`bun run lint:fix`, `bun run fmt`, and `bun run fmt:check`. Run these from the
package directory, or from the repository root to check or format everything.
Shared configuration lives in `.oxlintrc.json` and `.oxfmtrc.json`; the website
also enables its React and import lint rules. Generated files and build output
are excluded. Commit hooks report formatting issues; run `bun run fmt` to fix them.
