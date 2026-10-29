import { defineConfig } from "tsdown";

// One file, so oxlint and ESLint load the plugin from dist/index.js alone.
export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
});
