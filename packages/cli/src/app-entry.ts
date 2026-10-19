import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isBrickApp, requireBrickApp, type BrickApp } from "@brickkit/core";

export { isBrickApp, requireBrickApp, type BrickApp };

/**
 * Import an app entry to inspect it: to build it, or to read its routes. The app
 * is not run, so what creating it opened is released here: a workflow world
 * holds Redis connections that would keep the command from exiting.
 */
export async function loadBrickApp(entry: string): Promise<BrickApp> {
  const module = await import(pathToFileURL(resolve(entry)).href);
  const app = requireBrickApp(module.default);
  await app.events?.stop();
  return app;
}
