import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrickApp } from "./endpoints";

export function isBrickApp(app: unknown): app is BrickApp {
  if (!app || typeof app !== "object") return false;
  return (
    "endpoint" in app &&
    typeof app.endpoint === "function" &&
    "fetch" in app &&
    typeof app.fetch === "function" &&
    "listen" in app &&
    typeof app.listen === "function" &&
    "definition" in app &&
    !!app.definition &&
    typeof app.definition === "object" &&
    "services" in app.definition &&
    Array.isArray(app.definition.services) &&
    "prefix" in app.definition &&
    typeof app.definition.prefix === "string"
  );
}

export function requireBrickApp(app: unknown): BrickApp {
  if (!isBrickApp(app))
    throw new Error(
      "Brick: the entry module must default-export a BrickApp created by brick().",
    );
  if (app.server)
    throw new Error(
      "Brick: the app entry must not call .listen(); use a separate server bootstrap.",
    );
  return app;
}

export async function loadBrickApp(entry: string): Promise<BrickApp> {
  const module = await import(pathToFileURL(resolve(entry)).href);
  return requireBrickApp(module.default);
}
