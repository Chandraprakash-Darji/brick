// The entry points the reference covers: one page each. `file` is the source
// the published entry is built from (see each package's tsdown config), and
// `specifier` is what users import. test/api-reference.test.ts checks that this
// list matches every package's `exports`, so a new entry point cannot be missed.
export interface EntryPoint {
  slug: string;
  specifier: string;
  /** Repository-relative source file of the entry. */
  file: string;
  /** The tsconfig that resolves its imports. */
  tsconfig: string;
  description: string;
}

export const ENTRY_POINTS: EntryPoint[] = [
  {
    slug: "core",
    specifier: "@brickkit/core",
    file: "packages/core/src/index.ts",
    tsconfig: "packages/core/tsconfig.build.json",
    description:
      "Services, actions, tools, resources, databases, secrets, the HTTP runtime, and the typed contract of a Brick application.",
  },
  {
    slug: "core-client",
    specifier: "@brickkit/core/client",
    file: "packages/core/src/client.ts",
    tsconfig: "packages/core/tsconfig.build.json",
    description:
      "The typed HTTP client a frontend uses to call a Brick application, inferred from its contract.",
  },
  {
    slug: "core-tanstack-query",
    specifier: "@brickkit/core/tanstack-query",
    file: "packages/core/src/tanstack-query.ts",
    tsconfig: "packages/core/tsconfig.build.json",
    description:
      "TanStack Query options and keys for the typed client's actions.",
  },
  {
    slug: "core-pg",
    specifier: "@brickkit/core/pg",
    file: "packages/core/src/pg.ts",
    tsconfig: "packages/core/tsconfig.build.json",
    description:
      "Postgres databases for Brick services, with Drizzle's table builders.",
  },
  {
    slug: "cli",
    specifier: "@brickkit/cli",
    file: "packages/cli/src/index.ts",
    tsconfig: "packages/cli/tsconfig.build.json",
    description:
      "The brick command's building blocks: the dev and production servers, contract generation, and the OpenAPI pages.",
  },
  {
    slug: "cli-compiler",
    specifier: "@brickkit/cli/compiler",
    file: "packages/cli/src/compiler.ts",
    tsconfig: "packages/cli/tsconfig.build.json",
    description: "Compile and bind a Brick application's routes ahead of time.",
  },
  {
    slug: "cli-vite",
    specifier: "@brickkit/cli/vite",
    file: "packages/cli/src/vite.ts",
    tsconfig: "packages/cli/tsconfig.build.json",
    description:
      "The Vite plugin that generates the typed client contract and serves the dashboard.",
  },
  {
    slug: "cli-dev-reporter",
    specifier: "@brickkit/cli/dev-reporter",
    file: "packages/cli/src/dev-reporter.ts",
    tsconfig: "packages/cli/tsconfig.build.json",
    description:
      "Report a worker process's requests to a running dev dashboard.",
  },
  {
    slug: "crud",
    specifier: "@brickkit/crud",
    file: "packages/crud/src/index.ts",
    tsconfig: "packages/crud/tsconfig.json",
    description:
      "CRUD actions for a resource, with access rules, filters, and hooks.",
  },
];
