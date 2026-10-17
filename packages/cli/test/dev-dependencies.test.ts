import { test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function waitFor(check: () => boolean, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(50);
  }
  throw new Error("Timed out waiting for the dev restart");
}

async function freePort() {
  const listener = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = listener.port;
  listener.stop(true);
  return port;
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

test("brick dev restarts when an imported file outside the entry directory changes", async () => {
  const directory = await mkdtemp(
    join(resolve(import.meta.dir, "../../.."), ".dev-deps-"),
  );
  await mkdir(join(directory, "server"));
  await mkdir(join(directory, "shared"));
  await writeFile(
    join(directory, "shared/value.ts"),
    'export const value = "one";\n',
  );
  await writeFile(
    join(directory, "server/main.ts"),
    'import { value } from "../shared/value";\nconsole.log("loaded", value);\n',
  );
  const port = await freePort();
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, "../src/bin.ts"),
      "dev",
      "server/main.ts",
      "--port",
      String(port),
      "--no-dashboard",
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  );
  const logs = capture(child);
  try {
    await waitFor(() => logs.read().includes("loaded one"));
    await writeFile(
      join(directory, "shared/value.ts"),
      'export const value = "two";\n',
    );
    await waitFor(() => logs.read().includes("loaded two"));
  } finally {
    child.kill();
    await child.exited;
    await logs.finished;
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
