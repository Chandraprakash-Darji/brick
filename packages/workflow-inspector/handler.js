/**
 * In-process entry point of the inspector: a Web-standard fetch handler that a
 * server mounts under a base path, serving the prebuilt client assets and the
 * React Router SSR app. It reads the prebuilt `build/` as-is (it never runs
 * Vite), so the package must have been built.
 *
 * Derived from `@workflow/web/handler`. Brick change: the host passes its world
 * and manifest instead of the UI reading them from `WORKFLOW_*` variables.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStaticHandler } from "./static.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, "build");
const clientDir = path.join(buildDir, "client");
const serverEntry = path.join(buildDir, "server", "index.js");

/** Normalize a mount path: `/` or empty -> "" (root); otherwise strip trailing slash. */
function normalizeBasename(basename) {
  if (!basename || basename === "/") return "";
  return basename.endsWith("/") ? basename.slice(0, -1) : basename;
}

/**
 * @param {{ basename?: string, world: object, manifestPath?: string }} options
 * @returns {Promise<(request: Request) => Promise<Response>>}
 */
export async function createInspectorHandler(options) {
  const basename = normalizeBasename(options.basename ?? "/");
  if (!existsSync(serverEntry) || !existsSync(clientDir)) {
    throw new Error(
      "@brickkit/workflow-inspector has not been built (missing build/). " +
        "Run `bun run --filter @brickkit/workflow-inspector build`.",
    );
  }
  const mod = await import(pathToFileURL(serverEntry).href);
  const ssr = mod.createFetchHandler(basename || "/", {
    world: options.world,
    manifestPath: options.manifestPath,
  });
  // The host owns the connection; spending CPU on compression for a localhost
  // dev tool is a bad trade.
  const serveStatic = createStaticHandler({
    dir: clientDir,
    basename,
    compress: false,
  });
  return async (request) => (await serveStatic(request)) ?? ssr(request);
}
