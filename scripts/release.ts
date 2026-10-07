#!/usr/bin/env bun
// One-command release: bump version(s) -> commit -> tag -> push ->
// npm publish and GitHub release via the publish-npm.yml workflow.
//
//   bun run release [patch|minor|major] [--dry-run]
// Both packages use the same version and ship under one v<version> tag.
//
// Prerequisites (checked up front):
//   - clean tracked tree, on main, in sync with origin/main
//   - target tag(s) don't already exist on origin
//   - `gh` authenticated (for GitHub access)
//   - npm trust mappings configured per package (one-time, browser):
//     npmjs.com package Settings -> Trusted Publisher -> Chandraprakash-Darji/brick

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DRY = process.argv.includes("--dry-run");
const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
const [bump = "patch"] = args;

const CORE_PKG = join(ROOT, "packages/core/package.json");
const CLI_PKG = join(ROOT, "packages/cli/package.json");

function sh(cmd: string[], cwd = ROOT): string {
  if (DRY) {
    console.log(`  [dry-run] $ ${cmd.join(" ")}`);
    return "";
  }
  return execFileSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf-8" }).trim();
}

function fail(msg: string): never {
  console.error(`release: error: ${msg}`);
  process.exit(1);
}

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf-8"));
}

function writeJson(p: string, data: any): void {
  if (DRY) {
    console.log(`  [dry-run] write ${p}`);
    return;
  }
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function bumpVersion(v: string, kind: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) fail(`non-semver version "${v}" — bump it by hand`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") {
    major++;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor++;
    patch = 0;
  } else if (kind === "patch") {
    patch++;
  } else fail(`bump must be patch|minor|major, got "${kind}"`);
  return `${major}.${minor}.${patch}`;
}

if (args.length > 1 || !["patch", "minor", "major"].includes(bump))
  fail("usage: bun run release [patch|minor|major] [--dry-run]");

// --- preconditions ---
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: ROOT,
  encoding: "utf-8",
})
  .split("\n")
  .filter((l) => l && !l.startsWith("??"));
if (dirty.length)
  fail(`tracked tree not clean:\n${dirty.join("\n")}\ncommit or stash first`);
if (
  execFileSync("git", ["branch", "--show-current"], {
    cwd: ROOT,
    encoding: "utf-8",
  }).trim() !== "main"
)
  fail("must run on main");
execFileSync("git", ["fetch", "origin"], {
  cwd: ROOT,
  stdio: DRY ? "ignore" : "inherit",
});
const behind = execFileSync(
  "git",
  ["rev-list", "--count", "HEAD..origin/main"],
  {
    cwd: ROOT,
    encoding: "utf-8",
  },
).trim();
if (!DRY && behind !== "0")
  fail("local main is behind origin/main — pull first");
try {
  execFileSync("gh", ["auth", "status"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail("gh is not authenticated — run `gh auth login` first");
}

// --- compute new versions ---
const coreJson = readJson(CORE_PKG);
const cliJson = readJson(CLI_PKG);
if (coreJson.version !== cliJson.version)
  fail("core and cli versions must match");
const version = bumpVersion(coreJson.version, bump);
const tag = `v${version}`;
const releases = [
  { file: CORE_PKG, data: coreJson },
  { file: CLI_PKG, data: cliJson },
];
cliJson.dependencies["@brickkit/core"] = `^${version}`;
const exists = execFileSync(
  "git",
  ["ls-remote", "origin", `refs/tags/${tag}`],
  {
    cwd: ROOT,
    encoding: "utf-8",
  },
).trim();
if (exists) fail(`tag ${tag} already exists on origin`);

console.log("releasing:");
for (const r of releases)
  console.log(
    `  ${r.data.name}  ${r.data.version} -> ${version}  (tag ${tag})`,
  );
if (DRY) {
  console.log("dry-run only — no changes made");
  process.exit(0);
}

// --- apply, verify, ship ---
for (const r of releases) {
  r.data.version = version;
  writeJson(r.file, r.data);
}
sh(["bun", "install"]);
sh(["bun", "run", "build"]);
sh(["bun", "test", "packages/core", "packages/cli"]);

const msg = `chore(release): ${tag}`;
sh([
  "git",
  "add",
  "packages/core/package.json",
  "packages/cli/package.json",
  "bun.lock",
]);
sh(["git", "commit", "-m", msg]);
sh(["git", "tag", tag]);
sh(["git", "push", "--atomic", "origin", "main", tag]);
console.log(
  `  queued ${tag}; GitHub Actions publishes both packages, then creates one release`,
);

console.log("\nshipped. The publish workflow now publishes via OIDC:");
console.log(
  "  https://github.com/Chandraprakash-Darji/brick/actions/workflows/publish-npm.yml",
);
console.log(
  "Requires npm trusted-publisher entries or an NPM_TOKEN secret with publish access.",
);
