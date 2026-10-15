// Runs in the example directory. The site receives metadata, never server code.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { NativeBrickApp } from "../../packages/core/src";

const entry = process.argv[2];
if (!entry) throw new Error("Usage: example-architecture.ts <entry>");
const require = createRequire(resolve("package.json"));
const core: typeof import("../../packages/core/src") = await import(
  pathToFileURL(require.resolve("@brickkit/core")).href
);
const mod = await import(pathToFileURL(resolve(entry)).href);
async function resolveApp(): Promise<NativeBrickApp> {
  for (const candidate of [mod.default, mod.app]) {
    if (core.isNativeBrickApp(candidate)) return candidate;
  }
  if (typeof mod.buildApp === "function") {
    const candidate: unknown = await mod.buildApp();
    if (core.isNativeBrickApp(candidate)) return candidate;
  }
  throw new Error(`${entry}: export a native app or buildApp()`);
}
const app = await resolveApp();
try {
  const services = app.services.map((service) => ({
    name: service.name,
    resources: [],
    tables: [],
    actions: Object.values(service.actions).map((action) => ({
      name: action.endpoint.identifier,
      method: "POST",
      path: action.path,
    })),
  }));
  console.log(JSON.stringify({ prefix: "", services }));
} finally {
  await app.dispose();
}
