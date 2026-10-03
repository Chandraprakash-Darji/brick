#!/usr/bin/env bun
// One-command release: bump version(s) -> commit -> tag -> push ->
// GitHub release. The publish-npm.yml workflow then publishes to npm
// via OIDC trusted publishing (no tokens).
//
//   bun run release <core|cli|both> [patch|minor|major] [--dry-run]
//
// Examples:
//   bun run release both            # patch-bump core+cli, release both
//   bun run release cli minor       # minor-bump cli only
//   bun run release core patch --dry-run   # print what would happen
//
// Prerequisites (checked up front):
//   - clean tracked tree, on main, in sync with origin/main
//   - target tag(s) don't already exist on origin
//   - `gh` authenticated (for release creation)
//   - npm trust mappings configured per package (one-time, browser):
//     npmjs.com package Settings -> Trusted Publisher -> brick-org/brick

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DRY = process.argv.includes("--dry-run");
const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
const [target = "both", bump = "patch"] = args;

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
  if (kind === "major") { major++; minor = 0; patch = 0; }
  else if (kind === "minor") { minor++; patch = 0; }
  else if (kind === "patch") { patch++; }
  else fail(`bump must be patch|minor|major, got "${kind}"`);
  return `${major}.${minor}.${patch}`;
}

if (!["core", "cli", "both"].includes(target)) fail(`target must be core|cli|both, got "${target}"`);

// --- preconditions ---
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf-8" })
  .split("\n").filter((l) => l && !l.startsWith("??"));
if (dirty.length) fail(`tracked tree not clean:\n${dirty.join("\n")}\ncommit or stash first`);
if (execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf-8" }).trim() !== "main")
  fail("must run on main");
execFileSync("git", ["fetch", "origin"], { cwd: ROOT, stdio: DRY ? "ignore" : "inherit" });
const behind = execFileSync("git", ["rev-list", "--count", "HEAD..origin/main"], { cwd: ROOT, encoding: "utf-8" }).trim();
if (!DRY && behind !== "0") fail("local main is behind origin/main — pull first");
try {
  execFileSync("gh", ["auth", "status"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail("gh is not authenticated — run `gh auth login` first");
}

// --- compute new versions ---
const coreJson = readJson(CORE_PKG);
const cliJson = readJson(CLI_PKG);
const releases: Array<{ pkg: string; file: string; name: string; from: string; to: string; tag: string }> = [];

if (target === "core" || target === "both") {
  const to = bumpVersion(coreJson.version, bump);
  releases.push({ pkg: "core", file: CORE_PKG, name: "@elregaldo/core", from: coreJson.version, to, tag: `core-v${to}` });
}
if (target === "cli" || target === "both") {
  // In both-mode cli always gets at least a patch, so the release picks
  // up the (possibly moved) core floor even when cli code didn't change.
  const to = bumpVersion(cliJson.version, target === "cli" ? bump : "patch");
  releases.push({ pkg: "cli", file: CLI_PKG, name: "@elregaldo/cli", from: cliJson.version, to, tag: `cli-v${to}` });
}

// keep cli's core floor in sync when core moves (patch bumps already satisfy ^x.y.z)
const coreRel = releases.find((r) => r.pkg === "core");
if (coreRel) {
  const want = `^${coreRel.to}`;
  if (cliJson.dependencies["@elregaldo/core"] !== want) {
    if (!DRY) {
      cliJson.dependencies["@elregaldo/core"] = want;
      writeJson(CLI_PKG, cliJson);
    }
    console.log(`  @elregaldo/cli dependency floor -> ${want}`);
  }
}

// abort if any target tag already exists on origin (re-push would be a no-op publish)
for (const r of releases) {
  const exists = DRY ? "" : execFileSync("git", ["ls-remote", "origin", r.tag], { cwd: ROOT, encoding: "utf-8" }).trim();
  if (exists) fail(`tag ${r.tag} already exists on origin`);
}

console.log("releasing:");
for (const r of releases) console.log(`  ${r.name}  ${r.from} -> ${r.to}  (tag ${r.tag})`);
if (DRY) { console.log("dry-run only — no changes made"); process.exit(0); }

// --- apply, verify, ship ---
for (const r of releases) {
  const data = readJson(r.file);
  data.version = r.to;
  writeJson(r.file, data);
}
sh(["bun", "install"]);
sh(["bun", "run", "build"]);
sh(["bun", "test", "packages/core", "packages/cli"]);

const msg = `chore(release): ${releases.map((r) => `${r.name} v${r.to}`).join(", ")}`;
sh(["git", "add", "packages/core/package.json", "packages/cli/package.json", "bun.lock"]);
sh(["git", "commit", "-m", msg]);
for (const r of releases) sh(["git", "tag", r.tag]);
sh(["git", "push", "origin", "main"]);
sh(["git", "push", "origin", ...releases.map((r) => r.tag)]);
for (const r of releases) {
  sh(["gh", "release", "create", r.tag, "--title", `${r.name} v${r.to}`, "--generate-notes"]);
}

console.log("\nshipped. The publish workflow now publishes via OIDC:");
console.log("  https://github.com/brick-org/brick/actions/workflows/publish-npm.yml");
console.log("Requires npm trusted-publisher entries (one-time, browser) or the run 404s.");
if (coreRel) {
  console.log("Note: examples/pages pins @elregaldo/* from the registry — `bun install` there after publish.");
}
