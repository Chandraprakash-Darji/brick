import { expect, test } from "bun:test";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApplication } from "../src/build";
import { startDevApplication } from "../src/runner";

const root = resolve(import.meta.dir, "../../..");
const entry = join(import.meta.dir, "fixtures/native-app.ts");

async function unusedPort() {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(),
  });
  const port = server.port;
  await server.stop(true);
  return port;
}

test("native dev server owns its listener and scoped app", async () => {
  const port = await unusedPort();
  const running = await startDevApplication({ entry, port });
  try {
    const response = await fetch(`http://localhost:${port}/native/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "dev" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBe("dev");
  } finally {
    await running.stop();
  }
});

test("native CLI exports OpenAPI and architecture without a global registry", async () => {
  for (const args of [
    ["gen", "openapi", entry],
    ["info", entry],
  ]) {
    const process = Bun.spawn(
      [Bun.which("bun")!, join(root, "packages/cli/src/bin.ts"), ...args],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [status, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const output = JSON.parse(stdout);
    if (args[0] === "gen")
      expect(output.paths["/native/echo"].post.responses["404"]).toBeDefined();
    else
      expect(output.services[0].actions[0]).toEqual({
        name: "echo",
        method: "POST",
        path: "/native/echo",
      });
  }
});

test("native build runs outside the source tree and preserves validation and error statuses", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "brick-native-build-"));
  const deploy = await mkdtemp(join(tmpdir(), "brick-native-deploy-"));
  const port = await unusedPort();
  let process: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const built = await buildApplication({ entry, outdir, port });
    expect(built.ir.target).toBe("effect-http-api");
    expect(built.ir.routes).toHaveLength(1);
    await rename(built.entry, join(deploy, "server.js"));
    process = Bun.spawn([Bun.which("bun")!, join(deploy, "server.js")], {
      cwd: deploy,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, PORT: String(port) },
    });
    const reader = process.stdout.getReader();
    let output = "";
    while (!output.includes("http://localhost:")) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(5000).then(() => {
          throw new Error("Native bundle did not start");
        }),
      ]);
      if (chunk.done)
        throw new Error(await new Response(process.stderr).text());
      output += new TextDecoder().decode(chunk.value);
    }
    const call = (input: unknown) =>
      fetch(`http://localhost:${port}/native/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    expect(await (await call({ message: "built" })).json()).toBe("built");
    expect((await call({ message: 123 })).status).toBe(400);
    const missing = await call({ message: "missing" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      _tag: "NotFound",
      message: "No such message",
    });
    const docs = await fetch(`http://localhost:${port}/reference`);
    expect(docs.status).toBe(200);
  } finally {
    if (process) {
      process.kill();
      await process.exited;
    }
    await rm(outdir, { recursive: true, force: true });
    await rm(deploy, { recursive: true, force: true });
  }
}, 20000);

test("native startup waits for dependencies and releases resources on initialization or bind failure", async () => {
  const { Brick } = await import("@brickkit/core");
  const { action } = await import("@brickkit/core/contracts");
  const { Context, Effect, Layer, Schema } = await import("effect");
  const { startNativeServer } = await import("../src/native-server");
  class Resource extends Context.Service<Resource, {}>()(
    "cli-native-startup",
  ) {}
  const Read = action("read", "/read", {
    input: Schema.Void,
    output: Schema.String,
    errors: [],
  });
  const service = Brick.service("startup", {
    actions: { read: Read(() => Effect.as(Resource, "ready")) },
  });
  const events: string[] = [];
  const resource = Effect.acquireRelease(
    Effect.sync(() => {
      events.push("acquired");
      return {};
    }),
    () =>
      Effect.sync(() => {
        events.push("released");
      }),
  );
  const failure = new Error("Database initialization failed");
  const failed = Brick.app({
    services: [service],
    layer: Layer.effect(
      Resource,
      resource.pipe(Effect.andThen(Effect.fail(failure))),
    ),
  });
  await expect(
    startNativeServer(failed, { port: await unusedPort() }),
  ).rejects.toThrow("Database initialization failed");
  expect(events).toEqual(["acquired", "released"]);
  const occupied = Bun.serve({
    port: 0,
    fetch: () => new Response(),
  });
  try {
    const app = Brick.app({
      services: [service],
      layer: Layer.effect(Resource, resource),
    });
    await expect(
      startNativeServer(app, { port: occupied.port }),
    ).rejects.toThrow();
    expect(events).toEqual(["acquired", "released", "acquired", "released"]);
  } finally {
    await occupied.stop(true);
  }
});
