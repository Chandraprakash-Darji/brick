import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  fixedExtension: false,
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "browser",
  sourcemap: true,
});
