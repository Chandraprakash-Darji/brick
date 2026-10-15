import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, createServer } from "vite";
import { brickClient } from "../src/vite";

const fixture = resolve(import.meta.dir, "fixtures/native-app.ts");

function contract(path: string) {
  return `import { Schema } from "effect";
import { HttpApi, HttpApiGroup } from "effect/http-api";
import { action } from "@brickkit/core/contracts";
export const Echo = action("echo", ${JSON.stringify(path)}, { input: Schema.String, output: Schema.String, errors: [] });
export const Api = HttpApi.make("native-client").add(HttpApiGroup.make("pages").add(Echo.endpoint));
`;
}

test("native Vite generation reloads schema dependencies and disposes its app instances", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-native-vite-"),
  );
  const stateKey = `brick-vite-${root}`;
  await Bun.write(join(root, "contract.ts"), contract("/before"));
  await Bun.write(
    join(root, "app.ts"),
    `import { Brick } from "@brickkit/core";
import { Context, Effect, Layer } from "effect";
import { Echo } from "./contract";
const state = globalThis[${JSON.stringify(stateKey)}] ??= { acquired: 0, released: 0 };
class Resource extends Context.Service()(${JSON.stringify(stateKey)}) {}
const dependency = Layer.effect(Resource, Effect.acquireRelease(
  Effect.sync(() => { state.acquired++; return {}; }),
  () => Effect.sync(() => { state.released++; }),
));
const service = Brick.service("pages", { actions: { echo: Echo(value => Effect.as(Resource, value)) } });
const app = Brick.app({ services: [service], layer: dependency, client: { module: "./contract" } });
await app.ready();
export default app;
`,
  );
  const state = () => Reflect.get(globalThis, stateKey);
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [brickClient({ entry: "app.ts" })],
      server: { middlewareMode: true },
    });
    const generated = join(root, "_brick/contract.ts");
    expect(await Bun.file(generated).text()).toContain('"../contract"');
    expect(state()).toEqual({ acquired: 1, released: 0 });
    await Bun.write(join(root, "contract.ts"), contract("/after"));
    const deadline = Date.now() + 5000;
    while (state().acquired < 2 && Date.now() < deadline) await Bun.sleep(25);
    expect(state()).toEqual({ acquired: 2, released: 1 });
    await server.close();
    server = undefined;
    expect(state()).toEqual({ acquired: 2, released: 2 });
  } finally {
    await server?.close();
    Reflect.deleteProperty(globalThis, stateKey);
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

test("a native cold Vite browser build imports schemas and excludes handlers", async () => {
  const root = await mkdtemp(
    resolve(import.meta.dir, "../.brick-native-vite-"),
  );
  try {
    await Bun.write(
      join(root, "client.ts"),
      `import { api, createClient } from "./_brick/contract";
export const connect = () => createClient(api, { baseUrl: "http://localhost" });`,
    );
    const result = await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [brickClient({ entry: fixture })],
      build: {
        write: false,
        rolldownOptions: {
          input: join(root, "client.ts"),
          output: { format: "es" },
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const source = outputs
      .flatMap((output) => ("output" in output ? output.output : []))
      .filter((output) => output.type === "chunk")
      .map((output) => output.code)
      .join("\n");
    expect(source).toContain("/native/echo");
    expect(source).not.toContain("No such message");
    expect(source).not.toContain("drizzle-orm");
    expect(source).not.toContain("elysia");
    expect(await Bun.file(join(root, "_brick/contract.ts")).exists()).toBe(
      true,
    );
    await Bun.write(
      join(root, "client.ts"),
      'import app from "virtual:brick-app"; console.log(app);',
    );
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [brickClient({ entry: fixture })],
        build: {
          write: false,
          rolldownOptions: { input: join(root, "client.ts") },
        },
      }),
    ).rejects.toThrow("server-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
