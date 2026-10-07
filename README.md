# Brick-TS
*High-Throughput, Logical-Monolith / Physical-Microservices TypeScript Platform*

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
