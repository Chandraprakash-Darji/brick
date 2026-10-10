import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "brick-release-notes-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.com");
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "packages/core"), { recursive: true });
  copyFileSync(
    join(import.meta.dir, "release-notes.ts"),
    join(root, "scripts/release-notes.ts"),
  );
  const commit = (subject: string, version: string) => {
    writeFileSync(
      join(root, "packages/core/package.json"),
      JSON.stringify({ version }),
    );
    git("add", ".");
    git("commit", "--allow-empty", "-m", subject);
  };
  const notes = () =>
    execFileSync(process.execPath, ["scripts/release-notes.ts"], {
      cwd: root,
      encoding: "utf8",
    });
  return { git, commit, notes };
}

test("beta notes include only changes since the previous beta and omit maintenance", () => {
  const { git, commit, notes } = fixture();
  commit("feat: old stable feature", "0.2.4");
  git("tag", "v0.2.4");
  commit("feat: old beta feature", "0.3.0-beta.4");
  git("tag", "v0.3.0-beta.4");
  commit("fix: repository metadata", "0.3.0-beta.5");
  commit("style: formatting", "0.3.0-beta.5");
  commit("chore(release): v0.3.0-beta.5", "0.3.0-beta.5");
  git("tag", "v0.3.0-beta.5");
  const output = notes();
  expect(output).toContain("repository metadata");
  expect(output).toContain("v0.3.0-beta.4...v0.3.0-beta.5");
  for (const noise of [
    "old stable feature",
    "old beta feature",
    "formatting",
    "chore(release)",
    "Other Changes",
    "## @brickkit/crud",
    "## @brickkit/cli",
  ]) {
    expect(output).not.toContain(noise);
  }
});

test("stable notes include beta features and preserve breaking change markers", () => {
  const { git, commit, notes } = fixture();
  commit("chore(release): v0.2.4", "0.2.4");
  git("tag", "v0.2.4");
  commit("feat(core)!: new plugin API", "0.3.0-beta.0");
  git("tag", "v0.3.0-beta.0");
  commit("chore(release): v0.3.0", "0.3.0");
  git("tag", "v0.3.0");
  expect(notes()).toContain("feat(core)!: new plugin API");
  expect(notes()).toContain("v0.2.4...v0.3.0");
});

test("notes ignore tags on unrelated branches and handle maintenance-only releases", () => {
  const { git, commit, notes } = fixture();
  commit("feat: initial feature", "0.2.4");
  git("tag", "v0.2.4");
  git("checkout", "-b", "unrelated");
  commit("feat: unrelated", "0.9.0");
  git("tag", "v0.9.0");
  git("checkout", "main");
  commit("chore(release): v0.3.0-beta.0", "0.3.0-beta.0");
  expect(notes()).toContain("No user-facing package changes.");
  expect(notes()).toContain("v0.2.4...v0.3.0-beta.0");
});
