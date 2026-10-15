import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("prepares candidate versions without building, committing, or tagging", async () => {
  const root = await mkdtemp(join(tmpdir(), "brick-release-prepare-"));
  const checkout = join(root, "checkout");
  const origin = join(root, "origin.git");
  await mkdir(join(checkout, "scripts"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
  try {
    await cp(
      new URL("./release.ts", import.meta.url),
      join(checkout, "scripts/release.ts"),
    );
    await writeFile(join(checkout, ".gitignore"), "node_modules\n");
    await writeFile(
      join(checkout, "package.json"),
      JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
        scripts: { build: "exit 99", test: "exit 99" },
      }),
    );
    for (const name of ["core", "crud", "cli"]) {
      const directory = join(checkout, "packages", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: `@brickkit/${name}`,
          version: "0.7.2",
          ...(name === "cli"
            ? { dependencies: { "@brickkit/core": "^0.7.2" } }
            : {}),
          ...(name === "crud"
            ? { peerDependencies: { "@brickkit/core": "^0.7.2" } }
            : {}),
        }),
      );
    }
    execFileSync(process.execPath, ["install"], {
      cwd: checkout,
      stdio: "pipe",
    });
    git("init", "-b", "main");
    git("config", "user.name", "Release test");
    git("config", "user.email", "release@example.com");
    git("add", ".");
    git("commit", "-m", "fixture");
    git("init", "--bare", origin);
    git("--git-dir", origin, "fetch", checkout, "HEAD:refs/heads/main");
    git("remote", "add", "origin", origin);
    const head = git("rev-parse", "HEAD");
    execFileSync(
      process.execPath,
      ["scripts/release.ts", "patch", "--prepare"],
      { cwd: checkout, stdio: "pipe" },
    );
    for (const name of ["core", "crud", "cli"]) {
      const manifest = await Bun.file(
        join(checkout, "packages", name, "package.json"),
      ).json();
      expect(manifest.version).toBe("0.7.3");
      if (name === "cli")
        expect(manifest.dependencies["@brickkit/core"]).toBe("^0.7.3");
      if (name === "crud")
        expect(manifest.peerDependencies["@brickkit/core"]).toBe("^0.7.3");
    }
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("tag", "--list")).toBe("");
    expect(git("--git-dir", origin, "rev-parse", "main")).toBe(head);
    expect(git("--git-dir", origin, "tag", "--list")).toBe("");
    expect(await Bun.file(join(checkout, "bun.lock")).text()).toContain(
      '"version": "0.7.3"',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
