import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPEC_VERSION_SUPPORTS_SLOT_IDENTITY } from "@workflow/world";
import { decode } from "cbor-x";
import { createInspectorHandler } from "../handler.js";

const base = "http://localhost/inspect";

/** A world that records what the UI asks of it. */
function stubWorld() {
  const world = {
    specVersion: SPEC_VERSION_SUPPORTS_SLOT_IDENTITY,
    listed: 0,
    tokens: [] as string[],
    runs: {
      list: async () => {
        world.listed++;
        return { data: [], cursor: null, hasMore: false };
      },
    },
    hooks: {
      getByToken: async (token: string) => {
        world.tokens.push(token);
        throw new Error("No such hook");
      },
    },
  };
  return world;
}

async function rpc(
  handle: (request: Request) => Promise<Response>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await handle(
    new Request(`${base}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
    }),
  );
  expect(response.status).toBe(200);
  return decode(new Uint8Array(await response.arrayBuffer())) as {
    success: boolean;
    data: any;
  };
}

describe("createInspectorHandler", () => {
  const dir = mkdtempSync(join(tmpdir(), "brick-inspector-"));
  const manifestPath = join(dir, "manifest.json");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const world = stubWorld();
  let handle: (request: Request) => Promise<Response>;
  beforeAll(async () => {
    writeFileSync(
      manifestPath,
      JSON.stringify({ version: "1.0.0", steps: {}, workflows: { a: {} } }),
    );
    handle = await createInspectorHandler({
      basename: "/inspect",
      world,
      manifestPath,
    });
  });

  it("serves the page under its base path, without a header of its own", async () => {
    const response = await handle(new Request(`${base}/`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("/inspect/assets/");
    // The dashboard around it has the navigation, the health probe and the theme switch.
    for (const header of ["Connected to", "Health Check", "Workflow Logo"])
      expect(html).not.toContain(header);
    // It takes the theme of the page that frames it, before first paint.
    expect(html).toContain("window.parent.document.documentElement");
  });

  it("reads the world the host gave it", async () => {
    const before = world.listed;
    const answer = await rpc(handle, "fetchRuns", { params: {} });
    expect(answer.success).toBe(true);
    expect(world.listed).toBe(before + 1);
  });

  it("exposes nothing from the environment", async () => {
    // What upstream read to pick and describe its world.
    const env: Record<string, string> = {
      WORKFLOW_TARGET_WORLD: "@workflow/world-postgres",
      WORKFLOW_VERCEL_AUTH_TOKEN: "secret-vercel-token",
      WORKFLOW_REDIS_URI: "redis://secret-redis@example:6379",
      WORKFLOW_MANIFEST_PATH: "/secret/manifest.json",
      WORKFLOW_LOCAL_DATA_DIR: "/secret/data-dir",
    };
    const saved = Object.fromEntries(
      Object.keys(env).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, env);
    try {
      const answer = await rpc(handle, "getPublicServerConfig");
      expect(answer as unknown).toEqual({
        backendDisplayName: "Brick",
        backendId: "brick",
        publicEnv: {},
        sensitiveEnvKeys: [],
      });
      const text = JSON.stringify(answer);
      for (const value of Object.values(env)) expect(text).not.toContain(value);
    } finally {
      for (const [name, value] of Object.entries(saved))
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  });

  it("gives the SDK the host's world, which Resume hook reads", async () => {
    // An app that only records events may never set the SDK's world, so it may
    // hold another one, or none.
    const cache = Symbol.for("@workflow/world//cache");
    const global = globalThis as Record<symbol, unknown>;
    const other = stubWorld();
    const before = global[cache];
    global[cache] = other;
    try {
      const answer = await rpc(handle, "resumeHook", {
        token: "hook_token",
        payload: { approved: true },
      });
      expect(answer.success).toBe(false);
      expect(world.tokens).toEqual(["hook_token"]);
      expect(other.tokens).toEqual([]);
      expect(global[cache]).toBe(world);
    } finally {
      global[cache] = before;
    }
  });

  it("gives the Graph view the host's manifest, or an empty one", async () => {
    const found = await rpc(handle, "fetchWorkflowsManifest");
    expect(found.data.workflows).toEqual({ a: {} });

    const empty = await createInspectorHandler({
      basename: "/inspect",
      world,
      manifestPath: join(dir, "missing.json"),
    });
    expect((await rpc(empty, "fetchWorkflowsManifest")).data).toEqual({
      version: "1.0.0",
      steps: {},
      workflows: {},
    });
  });
});
