import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isBrickApp, requireBrickApp, type BrickApp } from "@brickkit/core";

export { isBrickApp, requireBrickApp, type BrickApp };

export async function loadBrickApp(entry: string): Promise<BrickApp> {
  const module = await import(pathToFileURL(resolve(entry)).href);
  return requireBrickApp(module.default);
}
