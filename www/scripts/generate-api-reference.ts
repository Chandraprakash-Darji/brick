// Builds the API reference from the JSDoc in the packages' source.
//
// For every entry point in scripts/api-reference/entries.ts this writes
//   content/docs/api-reference/<slug>.mdx   one page per entry point
// plus an index page and the section's meta.json. The output is generated at
// build time and not committed (see .gitignore), like src/generated.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { gitConfig, repoUrl } from "../src/lib/shared";
import { ENTRY_POINTS } from "./api-reference/entries";
import { extractExports } from "./api-reference/extract";
import {
  buildSymbolIndex,
  renderEntry,
  renderIndex,
  renderMeta,
  type EntryPage,
} from "./api-reference/render";

const here = dirname(fileURLToPath(import.meta.url));
const wwwRoot = resolve(here, "..");
const repoRoot = resolve(wwwRoot, "..");
const outDir = join(wwwRoot, "content/docs/api-reference");

const projects = new Map<string, Project>();
function projectFor(tsconfig: string): Project {
  let project = projects.get(tsconfig);
  if (!project) {
    project = new Project({
      tsConfigFilePath: join(repoRoot, tsconfig),
      skipAddingFilesFromTsConfig: true,
    });
    projects.set(tsconfig, project);
  }
  return project;
}

/**
 * Functions the packages define that have no description yet, so their pages
 * show a signature and nothing else. `--coverage` lists them by file.
 */
function reportCoverage(entries: EntryPage[]): void {
  const seen = new Set<string>();
  const missing = entries
    .flatMap((entry) => entry.symbols)
    .filter(
      (symbol) =>
        symbol.kind === "function" && !symbol.external && !symbol.description,
    )
    .filter((symbol) => {
      const key = `${symbol.source?.path}:${symbol.source?.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      `${a.source?.path}:${String(a.source?.line).padStart(6, "0")}`.localeCompare(
        `${b.source?.path}:${String(b.source?.line).padStart(6, "0")}`,
      ),
    );
  console.log(
    `[api-reference] ${missing.length} functions have no description`,
  );
  if (process.argv.includes("--coverage"))
    for (const symbol of missing)
      console.log(
        `  ${symbol.source?.path}:${symbol.source?.line} ${symbol.name}`,
      );
}

export async function generateApiReference(): Promise<void> {
  const started = Date.now();
  const entries: EntryPage[] = [];
  for (const entry of ENTRY_POINTS) {
    const project = projectFor(entry.tsconfig);
    const source = project.addSourceFileAtPath(join(repoRoot, entry.file));
    const problems: string[] = [];
    const symbols = extractExports(source, repoRoot, (message) =>
      problems.push(message),
    );
    for (const problem of problems)
      console.warn(`[api-reference] ${entry.specifier}: ${problem}`);
    entries.push({
      slug: entry.slug,
      specifier: entry.specifier,
      description: entry.description,
      symbols,
    });
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const repository = { url: repoUrl, branch: gitConfig.branch };
  await writeFile(join(outDir, "index.mdx"), renderIndex(entries));
  await writeFile(join(outDir, "meta.json"), renderMeta(entries));
  // One index of every export, so a type on one page links to its section on another.
  const index = buildSymbolIndex(entries);
  for (const entry of entries)
    await writeFile(
      join(outDir, `${entry.slug}.mdx`),
      renderEntry(entry, repository, index),
    );
  const count = entries.reduce((sum, entry) => sum + entry.symbols.length, 0);
  reportCoverage(entries);
  console.log(
    `[api-reference] ${count} exports on ${entries.length} pages in ${((Date.now() - started) / 1000).toFixed(1)}s (${(await readdir(outDir)).length} files)`,
  );
}

if (import.meta.main) await generateApiReference();
