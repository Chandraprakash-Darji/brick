import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
    const temporary = join(
      dirname(output),
      `.brick-contract-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, source, { flag: "wx" });
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return output;
}
