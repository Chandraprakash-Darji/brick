import type { Rule } from "./ast";
import {
  fileRules,
  PRESETS,
  resolveRules,
  rules,
  type PresetName,
  type Severity,
} from "./presets";
import { readProject } from "./project";

export type { BrickSettings, Rule } from "./ast";
export {
  ALWAYS_ERROR,
  APP_RULES,
  PRESETS,
  fileRules,
  resolveRules,
  type PresetName,
  type Severity,
} from "./presets";
export { readProject, type Project, type ProjectConfig } from "./project";
export { runFileRules, type LintMessage } from "./run";

const FILES = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

interface FlatConfig {
  name: string;
  files?: string[];
  ignores?: string[];
  plugins: Record<string, unknown>;
  settings?: Record<string, unknown>;
  rules: Record<string, Severity>;
}

interface OxlintConfig {
  jsPlugins: { name: string; specifier: string }[];
  settings: Record<string, unknown>;
  rules: Record<string, Severity>;
  ignorePatterns: string[];
}

/** The ESLint flat-config plugin; oxlint loads the same object through `jsPlugins`. */
export const brick = {
  meta: { name: "brick" },
  rules: rules as Record<string, Rule>,
  configs: {} as Record<PresetName, FlatConfig> & {
    /**
     * Presets, rule settings, ignores and paths from brick.config.ts. Returns
     * an ESLint flat-config array, or with `linter: "oxlint"` the fields of an
     * oxlint config.
     */
    fromProject: typeof fromProject;
  },
};

for (const name of Object.keys(PRESETS) as PresetName[])
  brick.configs[name] = {
    name: `brick/${name}`,
    plugins: { brick },
    rules: fileRules(resolveRules([name])),
  };

function fromProject(options?: {
  cwd?: string;
  config?: string;
  linter?: "eslint";
}): Promise<FlatConfig[]>;
function fromProject(options: {
  cwd?: string;
  config?: string;
  linter: "oxlint";
}): Promise<OxlintConfig>;
async function fromProject(
  options: { cwd?: string; config?: string; linter?: "eslint" | "oxlint" } = {},
): Promise<FlatConfig[] | OxlintConfig> {
  const project = await readProject(options);
  const lint = project.config.lint ?? {};
  const resolved = fileRules(resolveRules(lint.presets, lint.rules));
  const settings = { brick: project.settings };
  const ignore = [
    ...(lint.ignore ?? []),
    `${project.settings.generated.replace(/\/$/, "")}/**`,
  ];
  if (options.linter === "oxlint")
    return {
      jsPlugins: [{ name: "brick", specifier: "@brickkit/lint" }],
      settings,
      rules: resolved,
      ignorePatterns: ignore,
    };
  return [
    {
      name: "brick/project",
      files: FILES,
      ignores: ignore,
      plugins: { brick },
      settings,
      rules: resolved,
    },
  ];
}
brick.configs.fromProject = fromProject;

export default brick;
