// @brickkit/cli/lint/oxlint: the plugin for oxlint's jsPlugins, plus a config from brick.config.ts.
import type { Severity } from "./presets";
import { projectRules } from "./plugin";

export { brick as default } from "./plugin";

export interface OxlintConfig {
  jsPlugins: { name: string; specifier: string }[];
  settings: Record<string, unknown>;
  rules: Record<string, Severity>;
  ignorePatterns: string[];
}

/** Presets, rule settings, ignores and paths from brick.config.ts, as the fields of an oxlint config. */
export async function fromProject(
  options: { cwd?: string; config?: string } = {},
): Promise<OxlintConfig> {
  const { rules, settings, ignore } = await projectRules(options);
  return {
    jsPlugins: [{ name: "brick", specifier: "@brickkit/cli/lint/oxlint" }],
    settings,
    rules,
    ignorePatterns: ignore,
  };
}
