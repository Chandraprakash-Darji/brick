import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts", "src/native.ts", "src/sqlite.ts", "src/postgres.ts"],
  dts: true,
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
});
