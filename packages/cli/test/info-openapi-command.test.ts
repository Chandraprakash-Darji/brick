import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/bin.ts");
const entry = join(import.meta.dir, "fixtures/client-app.ts");

async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
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

it("gen openapi loads app entry and generates OpenAPI spec", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-vite-test-cli-"),
  );
  try {
    const result = await run(root, "gen", "openapi", entry);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const spec = JSON.parse(result.stdout);
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Brick-TS API Mesh");
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(spec.paths["/v2/records/search"]).toBeDefined();
    expect(spec.paths["/v2/users/{id}"]).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("gen openapi writes to --output file", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-vite-test-cli-"),
  );
  try {
    const outputFile = join(root, "api.json");
    const result = await run(
      root,
      "gen",
      "openapi",
      entry,
      "--output",
      outputFile,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(outputFile);
    const spec = JSON.parse(await Bun.file(outputFile).text());
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/v2/records/search"]).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("info loads app entry and exports architecture", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-vite-test-cli-"),
  );
  try {
    const result = await run(root, "info", entry);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const arch = JSON.parse(result.stdout);
    expect(arch.version).toBe("1.0.0");
    expect(arch.services).toBeDefined();
    expect(arch.services.length).toBeGreaterThan(0);
    expect(arch.services.some((s: any) => s.name === "records")).toBe(true);
    expect(arch.services.some((s: any) => s.name === "users")).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("services alias works like info", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-vite-test-cli-"),
  );
  try {
    const result = await run(root, "services", entry);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const arch = JSON.parse(result.stdout);
    expect(arch.version).toBe("1.0.0");
    expect(arch.services.length).toBeGreaterThan(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects invalid arguments and missing entry", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-vite-test-cli-"),
  );
  try {
    for (const args of [
      ["gen", "openapi"],
      ["gen", "openapi", "--output", "api.json"],
    ]) {
      const result = await run(root, ...args);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Usage: brick gen openapi");
    }
    for (const args of [["info"], ["info", "--output"]]) {
      const result = await run(root, ...args);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Usage: brick info");
    }
    const result = await run(root, "info", join(root, "missing.ts"));
    expect(result.code).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
