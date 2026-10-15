import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts", "src/effect.ts"],
  dts: true,
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
});
