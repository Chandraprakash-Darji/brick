import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const version = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8")).version;
const tag = `v${version}`;
const repo = "https://github.com/Chandraprakash-Darji/brick";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const previous = git("tag", "--list", "v*", "--sort=-version:refname")
  .split("\n").find((candidate) => /^v\d+\.\d+\.\d+$/.test(candidate) && candidate !== tag)
  // The first combined release follows the former per-package releases.
  ?? (git("tag", "--list", "core-v*", "--sort=-version:refname").split("\n")
    .find((candidate) => candidate !== `core-v${version}`));

for (const pkg of ["core", "cli"]) {
  console.log(`## @brickkit/${pkg}\n`);
  const commits = git("log", "--format=%H\t%s", previous ? `${previous}..HEAD` : "HEAD", "--", `packages/${pkg}`)
    .split("\n").filter(Boolean);
  for (const [heading, pattern] of [
    ["Features", /^feat(?:\([^)]*\))?:/],
    ["Bug Fixes", /^fix(?:\([^)]*\))?:/],
    ["Performance", /^perf(?:\([^)]*\))?:/],
    ["Other Changes", /^(?!perf(?:\([^)]*\))?:|feat(?:\([^)]*\))?:|fix(?:\([^)]*\))?:)/],
  ] as const) {
    const entries = commits.filter((line) => pattern.test(line.split("\t")[1]));
    if (!entries.length) continue;
    console.log(`### ${heading}\n`);
    for (const entry of entries) {
      const [sha, subject] = entry.split("\t");
      const description = subject.replace(/^(?:feat|fix|perf|docs|refactor|chore)(?:\([^)]*\))?:\s*/, "");
      console.log(`- ${description} ([${sha.slice(0, 7)}](${repo}/commit/${sha}))`);
    }
    console.log();
  }
  if (!commits.length) console.log("- No package-specific changes.\n");
}

console.log(previous
  ? `**Full changelog:** [${previous}...${tag}](${repo}/compare/${previous}...${tag})`
  : `**Full changelog:** [${tag}](${repo}/commits/${tag})`);
