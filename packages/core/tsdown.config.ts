import { defineConfig } from "tsdown";

// Publish bundle: ESM for Node 18+ and bundler consumers (Vite/Nitro).
// Dependencies and node builtins stay external; only workspace source is
// bundled. Entries mirror the package.json "exports" map.
export default defineConfig({
  dts: true,
  fixedExtension: false,
  hash: false,
  entry: ["src/index.ts", "src/pg.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
});
