import { expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/bin.ts");
const entry = join(import.meta.dir, "fixtures/client-app.ts");

async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, "gen", "client", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

it("generates a browser-safe contract with default/custom output and preserves unchanged files", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-vite-test-cli-"),
  );
  try {
    const result = await run(root, entry);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const output = join(root, "_brick/contract.ts");
    expect(result.stdout).toContain(output);
    const source = await Bun.file(output).text();
    expect(source).toContain("BrickClientAction<");
    expect(source).toContain("/v2/records/:doctype/value");
    expect(source).not.toContain("private_tool");
    const modified = (await stat(output)).mtimeMs;
    await Bun.sleep(20);
    expect((await run(root, entry)).code).toBe(0);
    expect((await stat(output)).mtimeMs).toBe(modified);
    expect((await run(root, entry, "--output", "web/api.ts")).code).toBe(0);
    expect(await Bun.file(join(root, "web/api.ts")).text()).toBe(source);
    const bundle = await Bun.build({
      entrypoints: [output],
      target: "browser",
    });
    expect(bundle.success).toBe(true);
    const browserSource = await bundle.outputs[0]!.text();
    expect(browserSource).not.toContain("__backend_only__");
    expect(browserSource).not.toContain("bun:sqlite");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects invalid arguments/default exports and never overwrites the app entry", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-vite-test-cli-"),
  );
  try {
    for (const args of [
      [],
      ["--output", "api.ts"],
      [entry, "--output"],
      [entry, "--wat"],
      [entry, "--output", "--wat"],
    ]) {
      const result = await run(root, ...args);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Usage: brick gen client");
    }
    const invalid = join(root, "app.ts");
    await Bun.write(invalid, "export default {};\n");
    const output = join(root, "contract.ts");
    await Bun.write(output, "existing contract\n");
    const result = await run(root, invalid, "--output", output);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("default-export a BrickApp");
    expect(await Bun.file(output).text()).toBe("existing contract\n");
    expect((await run(root, invalid, "--output", invalid)).stderr).toContain(
      "must not overwrite",
    );
    expect(await Bun.file(invalid).text()).toBe("export default {};\n");
    expect((await run(root, join(root, "missing.ts"))).code).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("bundles the CLI without a Vite runtime dependency", async () => {
  const bundle = await Bun.build({
    entrypoints: [cli],
    target: "bun",
    packages: "external",
  });
  expect(bundle.success).toBe(true);
  const source = await bundle.outputs[0]!.text();
  expect(source).not.toMatch(/(?:from\s*|import\s*\()["']vite(?:["'/])/);
});
