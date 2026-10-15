// Compile the actual quickstart and browser contract, then exercise their HTTP API.
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
const directory = await mkdtemp(join(tmpdir(), "brick-native-docs-"));
const code = async (page: string, title: string) => {
  const text = await Bun.file(
    resolve(import.meta.dir, "../content/docs", page),
  ).text();
  const marker = '```ts title="' + title + '"\n';
  const start = text.indexOf(marker);
  if (start === -1) throw new Error(`Missing ${title} in ${page}`);
  return text.slice(
    start + marker.length,
    text.indexOf("\n```", start + marker.length),
  );
};
try {
  await symlink(
    resolve(repo, "examples/showcase/node_modules"),
    join(directory, "node_modules"),
  );
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      extends: resolve(repo, "tsconfig.json"),
      compilerOptions: {
        noEmit: true,
        typeRoots: [resolve(repo, "node_modules/@types")],
      },
      include: ["*.ts"],
    }),
  );
  await writeFile(
    join(directory, "users.ts"),
    await code("(brick)/quickstart.mdx", "src/users.ts"),
  );
  await writeFile(
    join(directory, "app.ts"),
    await code("(brick)/quickstart.mdx", "src/app.ts"),
  );
  await writeFile(
    join(directory, "contract.ts"),
    await code("(brick)/typed-client.mdx", "src/contract.ts"),
  );
  await writeFile(
    join(directory, "main.ts"),
    `
import assert from "node:assert/strict";
import app from "./app";
import { Api } from "./contract";
import { OpenApi } from "effect/http-api";
try {
  assert.deepEqual(app.openApi().paths, OpenApi.fromApi(Api).paths);
  const request = (id: unknown) => app.fetch(new Request("http://localhost/api/users/getUser", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
  }));
  const found = await request("usr_42");
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), { id: "usr_42", name: "Ada" });
  assert.equal((await request("missing")).status, 404);
  assert.equal((await request(123)).status, 400);
} finally { await app.dispose(); }
`,
  );
  for (const command of [
    [resolve(repo, "node_modules/.bin/tsc"), "--noEmit"],
    ["bun", "main.ts"],
  ]) {
    const result = Bun.spawn(command, {
      cwd: directory,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await result.exited) !== 0)
      throw new Error(`Documentation example failed: ${command.join(" ")}`);
  }
  console.log("Native documentation examples compile and pass HTTP checks.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
