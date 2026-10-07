# Brick-TS
*High-Throughput, Logical-Monolith / Physical-Microservices TypeScript Platform*

Powered by **Bun (Rust core)** + **Elysia (AOT routing)** + **Better Auth** + **Drizzle ORM**.

Install the public packages:

```sh
bun add @brickkit/core @brickkit/cli
```

To release new versions from a clean, up-to-date `main` checkout:

```sh
bun run release both patch
```

The release script bumps versions, builds and tests the packages, then pushes
`core-v<version>` and `cli-v<version>` tags. GitHub Actions publishes the packages
to npm and creates a GitHub release after each successful publish. The
**Publish to npm** workflow also supports manual dispatch and a dry-run option.

For token-free publishing, configure a trusted publisher in each npm package's
settings: owner `Chandraprakash-Darji`, repository `brick`, workflow `publish-npm.yml`, with
`npm publish` allowed. The initial publish can use the repository's `NPM_TOKEN`
secret with write access to the `@brickkit` scope.
