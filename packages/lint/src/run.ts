import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrickSettings } from "./ast";
import type { Severity } from "./presets";

export interface LintMessage {
  /** Path from the project root. */
  file: string;
  line: number;
  column: number;
  /** `brick/<rule>`. */
  rule: string;
  severity: "error" | "warn";
  message: string;
}

/** This package's built plugin, which oxlint loads under Node. */
function pluginPath() {
  const here = fileURLToPath(import.meta.url);
  // From source (tests run src/ under Bun), use the build next to it.
  return here.endsWith(".ts")
    ? resolve(dirname(here), "../dist/index.js")
    : resolve(dirname(here), "index.js");
}

function oxlintBin(root: string) {
  for (const base of [
    join(root, "package.json"),
    fileURLToPath(import.meta.url),
  ]) {
    try {
      const pkg = createRequire(base).resolve("oxlint/package.json");
      return join(dirname(pkg), "bin/oxlint");
    } catch {
      // not installed there; try the next place
    }
  }
  throw new Error(
    "@brickkit/lint: running the file rules needs oxlint; add it to the project (bun add -d oxlint).",
  );
}

/**
 * Run the file rules over a project with oxlint, as `brick lint` does.
 * Only rules set to "error" or "warn" run; `ignore` globs are relative to `root`.
 */
export function runFileRules(options: {
  root: string;
  rules: Record<string, Severity>;
  settings: BrickSettings;
  ignore?: string[];
  /** Files or folders to lint, from `root` (default: all of it). */
  paths?: string[];
  fix?: boolean;
}): LintMessage[] {
  const rules = Object.fromEntries(
    Object.entries(options.rules).filter(([, severity]) => severity !== "off"),
  );
  if (Object.keys(rules).length === 0) return [];
  const directory = mkdtempSync(join(tmpdir(), "brick-lint-"));
  try {
    const config = join(directory, "oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({
        plugins: [],
        categories: { correctness: "off" },
        jsPlugins: [{ name: "brick", specifier: pluginPath() }],
        settings: { brick: options.settings },
        rules,
      }),
    );
    const result = spawnSync(
      oxlintBin(options.root),
      [
        "-c",
        config,
        "--format",
        "json",
        "--disable-nested-config",
        "--no-error-on-unmatched-pattern",
        ...(options.fix ? ["--fix"] : []),
        ...(options.ignore ?? []).flatMap((pattern) => [
          "--ignore-pattern",
          pattern,
        ]),
        ...(options.paths ?? ["."]),
      ],
      { cwd: options.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    let report: {
      diagnostics?: {
        message: string;
        code?: string;
        severity: string;
        filename: string;
        labels?: { span: { line: number; column: number } }[];
      }[];
    };
    try {
      report = JSON.parse(result.stdout);
    } catch {
      throw new Error(
        `@brickkit/lint: oxlint failed (exit ${result.status}):\n${result.stderr || result.stdout}`,
      );
    }
    return (report.diagnostics ?? []).map((diagnostic) => ({
      file: diagnostic.filename,
      line: diagnostic.labels?.[0]?.span.line ?? 1,
      column: diagnostic.labels?.[0]?.span.column ?? 1,
      // Parse errors come without a rule code.
      rule: diagnostic.code?.replace(/^brick\((.*)\)$/, "brick/$1") ?? "syntax",
      severity: diagnostic.severity === "error" ? "error" : "warn",
      message: diagnostic.message,
    }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
