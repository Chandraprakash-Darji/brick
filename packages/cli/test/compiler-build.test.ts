import { expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

it("builds a deployable server and runs generated handlers without the definitions module", async () => {
  const root = resolve(import.meta.dir, "../../..");
  await mkdir(join(root, ".brick"), { recursive: true });
  const dir = await mkdtemp(join(root, ".brick/compiler-test-"));
  const deploy = await mkdtemp(join(tmpdir(), "brick-deploy-"));
  let server: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const build = Bun.spawn(
      [
        process.execPath,
        join(root, "packages/cli/src/bin.ts"),
        "build",
        join(import.meta.dir, "fixtures/compiler-app.ts"),
        "--outdir",
        dir,
        "--prefix",
        "/v1",
        "--port",
        "0",
        "--no-request-logging",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("Compiled 3 services");
    const ir = await Bun.file(join(dir, "brick-ir.json")).json();
    expect(ir.prefix).toBe("/v1");
    expect(
      ir.routes.some((r: any) => r.path === "/api/public/pages/:slug"),
    ).toBe(true);
    expect(ir.reads[0].get).toContain('"page_id"');
    expect(await Bun.file(join(dir, "routes.js")).text()).toContain(
      "function bindAction",
    );
    // Deploy only the bundle, outside the source tree and node_modules resolution.
    await rename(join(dir, "server.js"), join(deploy, "server.js"));
    server = Bun.spawn([process.execPath, join(deploy, "server.js")], {
      cwd: deploy,
      env: { ...process.env, PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
    let output = "";
    while (!output.includes("http://localhost:")) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(5000).then(() => {
          throw new Error("Built server did not start");
        }),
      ]);
      if (chunk.done)
        throw new Error(
          "Built server exited before listening: " +
            (await new Response(server.stderr as ReadableStream).text()),
        );
      output += new TextDecoder().decode(chunk.value);
    }
    const base = output.match(/http:\/\/localhost:\d+/)![0];
    const ready = await fetch(`${base}/v1/plain/getReady`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true });
    const allowed = await fetch(`${base}/api/public/pages/hello`, {
      headers: { "x-user": "alice" },
    });
    expect(await allowed.json()).toEqual({ slug: "hello" });
    expect(allowed.headers.get("x-request-id")).toBeTruthy();
    expect(await (await fetch(`${base}/v1/page/one`)).json()).toEqual({
      id: "one",
      title: "Built page",
    });
    const list = (await (
      await fetch(`${base}/v1/page?limit=10`)
    ).json()) as any;
    expect(list.total).toBe(1);
    expect(list.items).toEqual([{ id: "one", title: "Built page" }]);
    const createdResponse = await fetch(`${base}/v1/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"title":"Created in deployed bundle"}',
    });
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as any;
    expect(created.title).toBe("Created in deployed bundle");
    const changed = await fetch(`${base}/v1/page/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: '{"title":"Updated in deployed bundle"}',
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({
      id: created.id,
      title: "Updated in deployed bundle",
    });
    expect(
      (await fetch(`${base}/v1/page/${created.id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
    expect((await fetch(`${base}/api/public/pages/hello`)).status).toBe(403);
    expect(
      (
        await fetch(`${base}/api/public/pages/x`, {
          headers: { "x-user": "alice" },
        })
      ).status,
    ).toBe(400);
    expect((await fetch(`${base}/docs`)).status).toBe(200);
    const spec = (await (await fetch(`${base}/openapi.json`)).json()) as any;
    expect(spec.paths["/v1/built/getPage"]).toBeDefined();
    server.kill("SIGTERM");
    expect(await server.exited).toBe(0);
  } finally {
    server?.kill();
    await rm(dir, { recursive: true, force: true });
    await rm(deploy, { recursive: true, force: true });
  }
}, 20000);
