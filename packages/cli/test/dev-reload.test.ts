import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function waitForValue(url: string, value: string) {
  const deadline = Date.now() + 8000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      });
      last = `${response.status} ${await response.text()}`;
      if (last === `200 {"v":"${value}"}`) return;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Expected ${value}; last response: ${last}`);
}

test.each([
  [false, "src"],
  [true, "src"],
  [false, "dist"],
  [true, "dist"],
])(
  "brick dev reloads dependency services (default app: %s, CLI: %s)",
  async (exportApp, cliDirectory) => {
    const directory = await mkdtemp(
      join(resolve(import.meta.dir, "../../.."), ".dev-reload-"),
    );
    const listener = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = listener.port;
    listener.stop(true);
    const service = (
      value: string,
    ) => `import { defineService } from "@brickkit/core";
const svc = defineService("rt", {});
svc.action({ name: "hi", execute: async () => ({ v: "${value}" }) });`;
    await writeFile(join(directory, "svc.ts"), service("ONE"));
    await writeFile(
      join(directory, "main.ts"),
      exportApp
        ? 'import "./svc"; import { brick } from "@brickkit/core"; export default brick({ prefix: "/custom" });'
        : 'import "./svc";',
    );
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(
          import.meta.dir,
          `../${cliDirectory}/bin.${cliDirectory === "src" ? "ts" : "js"}`,
        ),
        "dev",
        "main.ts",
        "--port",
        String(port),
      ],
      { cwd: directory, stdout: "ignore", stderr: "inherit" },
    );
    try {
      const url = `http://localhost:${port}/${exportApp ? "custom" : "api"}/rt/hi`;
      await waitForValue(url, "ONE");
      await writeFile(join(directory, "svc.ts"), service("TWO"));
      await waitForValue(url, "TWO");
      await writeFile(join(directory, "svc.ts"), service("THREE"));
      await waitForValue(url, "THREE");
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill();
      await child.exited;
      await rm(directory, { recursive: true, force: true });
    }
  },
  25000,
);
