// Physical entry for `@brickkit/core/pg` (see `./db/pg.ts`).
//
// Some resolvers (e.g. the better-auth CLI config loader) probe the
// subpath naively as `<package-dir>/src/pg` instead of honoring the
// `exports` map, so this file must exist alongside the export entry.
export * from "./db/pg";
