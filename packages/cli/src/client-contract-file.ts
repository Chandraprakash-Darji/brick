import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateClientContract } from "./client-contract";
import type { BrickApp } from "./endpoints";

/** Generate a client contract without loading Vite or starting a server. */
export async function writeClientContract(
  entryPath: string,
  outputPath?: string,
) {
  const entry = resolve(entryPath);
  const output = resolve(outputPath ?? "_brick/contract.ts");
  if (entry === output)
    throw new Error("Brick: contract output must not overwrite the app entry.");
  const { default: app } = await import(pathToFileURL(entry).href);
  if (!app || typeof app.endpoint !== "function" || !app.definition)
    throw new Error(
      "Brick: the entry module must default-export a BrickApp created by brick().",
    );
  const source = generateClientContract(app as BrickApp);
  const previous = await readFile(output, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (previous !== source) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, source);
  }
  return output;
}
