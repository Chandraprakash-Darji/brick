import { defineConfig } from "tsdown";

// Publish bundle: ESM for Node 18+ and bundler consumers (Vite/Nitro).
// @elregaldo/core and all node_modules stay external; only this package's
// source is bundled. Entries mirror package.json "exports" plus the bin.
export default defineConfig({
  dts: true,
  fixedExtension: false,
  hash: false,
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
});
