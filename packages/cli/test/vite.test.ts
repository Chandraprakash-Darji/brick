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
  ) => `import { defineService, t } from "@brickkit/core";
const service = defineService("reload");
service.action({ name: "value", output: t.String(), input: t.Object({ id: t.String()${value == "after" ? ", locale: t.String()" : ""} }), execute: () => ${JSON.stringify(value)} });
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
    const contractFile = join(root, "_brick/contract.ts");
    const initialContract = await Bun.file(contractFile).text();
    expect(initialContract).toContain('"id": string');
    expect(initialContract).not.toContain('"locale": string');
    const app = (await environment.runner.import("virtual:brick-app")).default;
    const request = () =>
      new Request("http://localhost/api/reload/value", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1", locale: "en" }),
      });
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
    expect(await Bun.file(contractFile).text()).toContain('"locale": string');
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
  try {
    await expect(
      createServer({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [brickClient({ entry: "bad.ts" })],
        server: { middlewareMode: true },
      }),
    ).rejects.toThrow("default-export a BrickApp");
    await Bun.write(
      join(root, "good.ts"),
      `import { brick } from ${JSON.stringify(resolve(import.meta.dir, "../src/server.ts"))};
export default brick({ services: [], requestLogging: false });`,
    );
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [brickClient({ entry: "good.ts" })],
        build: {
          write: false,
          rolldownOptions: { input: join(root, "client.ts") },
        },
      }),
    ).rejects.toThrow("server-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("generates the contract before a cold production build without bundling the backend", async () => {
  const root = await mkdtemp(resolve(import.meta.dir, "../.brick-vite-test-"));
  const entry = resolve(import.meta.dir, "fixtures/client-app.ts");
  await Bun.write(
    join(root, "client.ts"),
    `import { createBrickClient } from "@brickkit/core/client";
import { contract } from "./_brick/contract";
export const api = createBrickClient({ baseUrl: "http://localhost", contract });
`,
  );
  try {
    expect(await Bun.file(join(root, "_brick/contract.ts")).exists()).toBe(
      false,
    );
    const result = await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [brickClient({ entry })],
      build: {
        write: false,
        rolldownOptions: { input: join(root, "client.ts") },
      },
    });
    expect(await Bun.file(join(root, "_brick/contract.ts")).exists()).toBe(
      true,
    );
    const contractSource = await Bun.file(
      join(root, "_brick/contract.ts"),
    ).text();
    expect(contractSource).toContain("export type BrickJsonValue =");
    expect(contractSource).toContain("{ [key: string]: BrickJsonValue }");
    const outputs = Array.isArray(result) ? result : [result];
    const source = outputs
      .flatMap((output) => ("output" in output ? output.output : []))
      .filter((output) => output.type === "chunk")
      .map((output) => output.code)
      .join("\n");
    expect(source).toContain("/v2/records/:doctype/value");
    expect(source).not.toContain("__backend_only__");
    expect(source).not.toContain("__unselected__");
    expect(source).not.toContain("defineService");
    expect(source).not.toContain("bun:sqlite");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
