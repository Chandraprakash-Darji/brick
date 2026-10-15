import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isNativeBrickApp, type NativeBrickApp } from "@brickkit/core";

export async function loadApplication(entry: string): Promise<NativeBrickApp> {
  const module = await import(pathToFileURL(resolve(entry)).href);
  if (!isNativeBrickApp(module.default))
    throw new Error(
      "Brick: the entry module must default-export a BrickApp created by Brick.app().",
    );
  return module.default;
}
