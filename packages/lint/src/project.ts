import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrickSettings } from "./ast";
import type { PresetName, Severity } from "./presets";

/** The parts of brick.config.ts lint reads. `defineConfig` in @brickkit/cli types the whole file. */
export interface ProjectConfig {
  entry?: string;
  services?: string;
  generated?: string;
  lint?: {
    presets?: PresetName[];
    rules?: Record<string, Severity>;
    ignore?: string[];
  };
}

export interface Project {
  /** Folder of brick.config.ts, or the working directory without one. */
  root: string;
  file?: string;
  config: ProjectConfig;
  settings: BrickSettings;
}

/** Read the nearest brick.config.ts (or `config`), with Brick's default paths. */
export async function readProject(
  options: { cwd?: string; config?: string } = {},
): Promise<Project> {
  const cwd = resolve(options.cwd ?? process.cwd());
  let file = options.config ? resolve(cwd, options.config) : undefined;
  for (let dir = cwd; !file; dir = dirname(dir)) {
    if (existsSync(join(dir, "brick.config.ts")))
      file = join(dir, "brick.config.ts");
    else if (dirname(dir) === dir) break;
  }
  const config: ProjectConfig = file
    ? ((await import(pathToFileURL(file).href)).default ?? {})
    : {};
  const root = file ? dirname(file) : cwd;
  return {
    root,
    file,
    config,
    settings: {
      root,
      services: config.services ?? "src/services",
      entry: config.entry ?? "src/app.ts",
      generated: config.generated ?? "_brick",
      web: "web",
    },
  };
}
