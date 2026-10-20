import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "cbor-x";
import { createInspectorHandler } from "../handler.js";

const base = "http://localhost/inspect";

/** A world that records what the UI asks of it. */
function stubWorld() {
  const world = {
    listed: 0,
    runs: {
      list: async () => {
        world.listed++;
        return { data: [], cursor: null, hasMore: false };
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
    process.env.WORKFLOW_POSTGRES_URL = "postgres://secret@example/db";
    try {
      const answer = await rpc(handle, "getPublicServerConfig");
      expect(answer).toMatchObject({
        backendId: "brick",
        publicEnv: {},
        sensitiveEnvKeys: [],
      });
      expect(JSON.stringify(answer)).not.toContain("secret");
    } finally {
      delete process.env.WORKFLOW_POSTGRES_URL;
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
