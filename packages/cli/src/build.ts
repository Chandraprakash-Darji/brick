import { join, resolve } from "node:path";
import { loadApplication } from "./app-entry";
import { buildNativeApplication } from "./native-build";

export interface BuildApplicationOptions {
  /** Module whose default export is a Brick.app(), without starting a server. */
  entry: string;
  outdir?: string;
  port?: number;
}

/** Bundle the application and its scoped Effect dependencies into a Bun server. */
export async function buildApplication(options: BuildApplicationOptions) {
  const entry = resolve(options.entry);
  if (!(await Bun.file(entry).exists()))
    throw new Error(`Brick: entry not found: ${entry}`);
  const outdir = resolve(options.outdir ?? "dist/brick");
  if (entry === join(outdir, "server.js"))
    throw new Error("Brick: output would overwrite the application entry");
  const port = options.port ?? 4000;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Brick: port must be an integer between 1 and 65535");
  const app = await loadApplication(entry);
  return buildNativeApplication({ entry, outdir, port }, app);
}
