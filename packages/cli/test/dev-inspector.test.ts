import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brick } from "@brickkit/core";
import { startInspector } from "../src/dev-inspector";

const root = join(import.meta.dir, "fixtures", "workflow-app");

describe("startInspector", () => {
  it("serves the inspector for the app's own world, to the dashboard only", async () => {
    // All the inspector reads of an app is where its workflows are and its world.
    const world = {
      listed: 0,
      runs: {
        list: async () => {
          world.listed++;
          return { data: [], cursor: null, hasMore: false };
        },
      },
    };
    const app = {
      events: {
        workflows: { root, dir: join(root, ".well-known/workflow/v1"), world },
      },
    };
    const inspector = await startInspector(app as never);
    try {
      expect(inspector).toBeDefined();
      const base = `http://127.0.0.1:${inspector!.port}`;
      const headers = { "x-brick-inspector": inspector!.token };

      expect((await fetch(`${base}/workflows/`)).status).toBe(403);
      const page = await fetch(`${base}/workflows/`, { headers });
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");

      // The UI lists runs through the world it finds by module name: ours.
      const rpc = await fetch(`${base}/workflows/api/rpc`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ method: "fetchRuns", params: { params: {} } }),
      });
      expect(rpc.status).toBe(200);
      expect(world.listed).toBe(1);
    } finally {
      inspector?.stop();
    }
  });

  it("does nothing for an app that runs no workflows", async () => {
    expect(await startInspector(brick({ docs: false }))).toBeUndefined();
  });

  it("does nothing when @brickkit/workflow-inspector is not installed", async () => {
    const bare = mkdtempSync(join(tmpdir(), "brick-no-inspector-"));
    try {
      const app = {
        events: { workflows: { root: bare, dir: bare, world: {} } },
      };
      expect(await startInspector(app as never)).toBeUndefined();
    } finally {
      rmSync(bare, { recursive: true });
    }
  });
});
