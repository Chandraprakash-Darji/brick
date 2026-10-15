import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parsePort } from "../src/port-utils";

async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for supervisor behavior");
}

async function fixture() {
  const directory = await mkdtemp(
    join(resolve(import.meta.dir, ".."), ".dev-supervisor-"),
  );
  const listener = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = listener.port;
  listener.stop(true);
  return { directory, port };
}

function capture(child: ReturnType<typeof Bun.spawn>) {
  let output = "";
  const collect = async (stream: typeof child.stdout) => {
    if (typeof stream === "number" || !stream) return;
    for await (const chunk of stream) output += new TextDecoder().decode(chunk);
  };
  const finished = Promise.all([collect(child.stdout), collect(child.stderr)]);
  return { read: () => output, finished };
}

test("empty PORT falls back to the default", () => {
  expect(parsePort(undefined, "")).toBe(4000);
  expect(parsePort("5000", "")).toBe(5000);
});

test("worker exits are reported and edits recover without intentional-exit warnings", async () => {
  const { directory, port } = await fixture();
  const entry = join(directory, "main.ts");
  await writeFile(entry, "process.exit(7);");
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, "../src/bin.ts"),
      "dev",
      entry,
      "--port",
      String(port),
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  );
  const logs = capture(child);
  try {
    await waitFor(() =>
      logs.read().includes("Application process exited with code 7"),
    );
    expect(child.exitCode).toBeNull();
    await writeFile(
      entry,
      'import { Brick } from "@brickkit/core"; import { Effect, Layer } from "effect"; import { HttpServerResponse } from "effect/http"; export default Brick.app({services:[],layer:Layer.empty,routes:Brick.route("GET","/ready",Effect.succeed(HttpServerResponse.text("ready")))});',
    );
    await waitFor(async () => {
      try {
        return (await fetch(`http://localhost:${port}/ready`)).status === 200;
      } catch {
        return false;
      }
    });
    await writeFile(entry, "process.exit(9);");
    await waitFor(() =>
      logs.read().includes("Application process exited with code 9"),
    );
    expect(logs.read().match(/Application process exited/g)).toHaveLength(2);
  } finally {
    child.kill();
    await child.exited;
    await logs.finished;
    await rm(directory, { recursive: true, force: true });
  }
  expect(logs.read().match(/Application process exited/g)).toHaveLength(2);
}, 15000);
