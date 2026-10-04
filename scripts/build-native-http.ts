import { copyFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
const crate = resolve(import.meta.dir, "../native/brick-http");
if (!process.argv.includes("--bridge-only")) {
  const bins = Bun.spawn(["cargo", "build", "--release", "--bins", "--manifest-path", resolve(crate, "Cargo.toml")], { stdout: "inherit", stderr: "inherit" });
  if (await bins.exited !== 0) process.exit(1);
}
const bridge = Bun.spawn(["cargo", "build", "--release", "--features", "bridge", "--lib", "--manifest-path", resolve(crate, "Cargo.toml")], { stdout: "inherit", stderr: "inherit" });
if (await bridge.exited !== 0) process.exit(1);
const library = process.platform === "darwin" ? "libbrick_http.dylib" : process.platform === "win32" ? "brick_http.dll" : "libbrick_http.so";
const output = resolve(crate, "target/release/brick-http.node");
const temporary = `${output}.${process.pid}.tmp`;
await copyFile(resolve(crate, "target/release", library), temporary);
await rename(temporary, output);
console.log(`Native Bun addon: ${output}`);
