import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer, isRunnableDevEnvironment, build } from "vite";
import { brickClient } from "../src/vite";

it("loads any default-exported BrickApp and reloads edits to its action dependencies", async () => {
  const root = await mkdtemp(resolve(import.meta.dir, "../.brick-vite-test-"));
  const cli = resolve(import.meta.dir, "../src/server.ts");
  const actions = (
    value: string,
  ) => `import { defineService } from "@brickkit/core";
const service = defineService("reload");
service.action({ name: "value", execute: () => ${JSON.stringify(value)} });
export default service;
`;
  await Bun.write(join(root, "actions.ts"), actions("before"));
  await Bun.write(
    join(root, "any-name.ts"),
    `import { brick } from ${JSON.stringify(cli)};
import service from "./actions";
export default brick({ services: [service], requestLogging: false });
`,
  );
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [brickClient({ entry: "./any-name.ts" })],
    server: { middlewareMode: true },
  });
  try {
    const environment = server.environments.ssr!;
    expect(isRunnableDevEnvironment(environment)).toBe(true);
    if (!isRunnableDevEnvironment(environment))
      throw new Error("Missing runnable SSR environment");
    const app = (await environment.runner.import("virtual:brick-app")).default;
    const request = () =>
      new Request("http://localhost/api/reload/value", { method: "POST" });
    expect(await (await app.fetch(request())).text()).toBe("before");
    await Bun.write(join(root, "actions.ts"), actions("after"));
    let result = "before";
    const deadline = Date.now() + 5000;
    while (result !== "after" && Date.now() < deadline) {
      await Bun.sleep(50);
      const updated = (await environment.runner.import("virtual:brick-app"))
        .default;
      result = await (await updated.fetch(request())).text();
    }
    expect(result).toBe("after");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

it("rejects a non-BrickApp default export and prevents browser imports of the backend", async () => {
  const root = await mkdtemp(resolve(import.meta.dir, "../.brick-vite-test-"));
  await Bun.write(join(root, "bad.ts"), "export default {};\n");
  await Bun.write(
    join(root, "client.ts"),
    'import app from "virtual:brick-app"; console.log(app);\n',
  );
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [brickClient({ entry: "bad.ts" })],
    server: { middlewareMode: true },
  });
  try {
    const environment = server.environments.ssr!;
    if (!isRunnableDevEnvironment(environment))
      throw new Error("Missing runnable SSR environment");
    await expect(
      environment.runner.import("virtual:brick-app"),
    ).rejects.toThrow("default-export a BrickApp");
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [brickClient({ entry: "bad.ts" })],
        build: {
          write: false,
          rolldownOptions: { input: join(root, "client.ts") },
        },
      }),
    ).rejects.toThrow("server-only");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
