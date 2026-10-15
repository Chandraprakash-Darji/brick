import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startDevServer, startDevApplication } from "../src/runner";
import { buildApplication } from "../src/build";

test("servers require an explicit application and reject missing entries", async () => {
  await expect(startDevServer({})).rejects.toThrow("entry is required");
  await expect(startDevApplication({})).rejects.toThrow("entry is required");
  await expect(startDevServer({ entry: "does-not-exist.ts" })).rejects.toThrow(
    "entry not found",
  );
});

test("invalid apps and invalid build destinations fail before publishing output", async () => {
  const root = await mkdtemp(join(import.meta.dir, ".runner-"));
  try {
    const entry = join(root, "app.ts");
    await Bun.write(entry, "export default {};\n");
    await expect(startDevApplication({ entry })).rejects.toThrow("Brick.app()");
    await expect(
      buildApplication({ entry, outdir: join(root, "out") }),
    ).rejects.toThrow("Brick.app()");
    expect(await Bun.file(join(root, "out/server.js")).exists()).toBe(false);
    await expect(buildApplication({ entry, port: 0 })).rejects.toThrow("port");
    const generated = join(root, "server.js");
    await Bun.write(generated, "export default {};\n");
    await expect(
      buildApplication({ entry: generated, outdir: root }),
    ).rejects.toThrow("overwrite");
    await expect(
      buildApplication({ entry: resolve(root, "missing.ts") }),
    ).rejects.toThrow("entry not found");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
