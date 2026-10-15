import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Brick, isNativeBrickApp } from "@brickkit/core";
import { NotFound } from "@brickkit/core/contracts";
import { writeClientContract } from "../src/client-contract-file";
import { generateNativeClientContract } from "../src/native-client-contract";
import { loadApplication } from "../src/app-entry";

const entry = resolve(import.meta.dir, "fixtures/native-app.ts");
const root = resolve(import.meta.dir, "../../..");

test("generated native client imports the shared schemas, bundles for browsers, and decodes errors", async () => {
  await mkdir(join(root, ".brick"), { recursive: true });
  const dir = await mkdtemp(join(root, ".brick/native-client-"));
  const app = await loadApplication(entry);
  if (!isNativeBrickApp(app)) throw new Error("Expected native fixture");
  const web = Brick.mount(app.layer);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => web.fetch(request),
  });
  let dispose: (() => Promise<void>) | undefined;
  try {
    const output = await writeClientContract(entry, join(dir, "contract.ts"));
    const built = await Bun.build({ entrypoints: [output], target: "browser" });
    expect(built.success).toBe(true);
    const source = await built.outputs[0]!.text();
    expect(source).not.toContain("No such message");
    expect(source).not.toContain("drizzle-orm");
    expect(source).not.toContain("elysia");
    const generated = await import(output);
    const managed = await generated.createClient(generated.api, {
      baseUrl: server.url,
    });
    dispose = managed.dispose;
    expect(
      await managed.client.pages.echo({ payload: { message: "generated" } }),
    ).toBe("generated");
    try {
      await managed.client.pages.echo({ payload: { message: "missing" } });
      throw new Error("Expected declared failure");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFound);
    }
  } finally {
    await dispose?.();
    await server.stop(true);
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("native client generation rejects absent configuration and non-schema modules", async () => {
  const app = await loadApplication(entry);
  if (!isNativeBrickApp(app)) throw new Error("Expected native fixture");
  await expect(
    generateNativeClientContract(
      { ...app, client: undefined },
      { entry, output: "/tmp/contract.ts" },
    ),
  ).rejects.toThrow("client.module");
  await expect(
    generateNativeClientContract(
      { ...app, client: { module: "./native-app" } },
      { entry, output: "/tmp/contract.ts" },
    ),
  ).rejects.toThrow("separate schema module");
  await expect(
    generateNativeClientContract(
      {
        ...app,
        client: { module: "./native-contract", exportName: "MissingExport" },
      },
      { entry, output: "/tmp/contract.ts" },
    ),
  ).rejects.toThrow("MissingExport");
});
