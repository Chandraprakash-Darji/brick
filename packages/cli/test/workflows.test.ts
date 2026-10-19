import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadBrickApp } from "../src/app-entry";
import { buildApplication } from "../src/build";
import { buildWorkflows, registerWorkflowTransform } from "../src/workflows";

const root = join(import.meta.dir, "fixtures", "workflow-app");
const dir = join(root, ".well-known", "workflow", "v1");
const WORKFLOW_ID = "workflow//./src/hello//hello";

describe("workflow build and transform", () => {
  it("does nothing, and says so, in a project without the Workflow SDK", async () => {
    const bare = mkdtempSync(join(tmpdir(), "brick-no-sdk-"));
    try {
      expect(await registerWorkflowTransform(bare)).toBe(false);
      await expect(buildWorkflows({ root: bare })).rejects.toThrow(
        "bun add -d @workflow/builders",
      );
    } finally {
      rmSync(bare, { recursive: true });
    }
  });

  it("builds the bundle and a manifest that names the workflow", async () => {
    rmSync(join(root, ".well-known"), { recursive: true, force: true });
    await buildWorkflows({ root });

    expect(existsSync(join(dir, "flow.mjs"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest.workflows["src/hello.ts"].hello.workflowId).toBe(
      WORKFLOW_ID,
    );
    expect(manifest.steps["src/hello.ts"].greet.stepId).toBe(
      "step//./src/hello//greet",
    );
  });

  it("gives a workflow the id the bundle knows, and registers its steps", async () => {
    expect(await registerWorkflowTransform(root)).toBe(true);
    const { hello } = await import("./fixtures/workflow-app/src/hello");

    expect((hello as { workflowId?: string }).workflowId).toBe(WORKFLOW_ID);
    const steps = (globalThis as Record<symbol, unknown>)[
      Symbol.for("@workflow/core//registeredSteps")
    ] as Map<string, unknown>;
    expect(steps.has("step//./src/hello//greet")).toBe(true);
  });

  it("leaves the generated bundle alone when it is loaded", async () => {
    // The bundle holds the directives as text inside the SDK's own code. Transforming
    // it failed with "Classes using use step methods must be declared at the top level".
    const bundle = await import(pathToFileURL(join(dir, "flow.mjs")).href);
    expect(typeof bundle.POST).toBe("function");
  });
});

describe("apps with workflows", () => {
  const entry = join(root, "src", "app.ts");

  it("releases the world when an app is only inspected", async () => {
    const { world } = await import("./fixtures/workflow-app/src/app");
    const before = world.closed;
    await loadBrickApp(entry);
    expect(world.closed).toBeGreaterThan(before);
  });

  it("brick build transforms the workflows, builds the bundle, and starts events in the server", async () => {
    rmSync(join(root, ".well-known"), { recursive: true, force: true });
    const outdir = join(root, "dist", "brick");
    try {
      await buildApplication({ entry, outdir });
      const server = readFileSync(join(outdir, "server.js"), "utf8");
      expect(server).toContain(WORKFLOW_ID);
      expect(server).toContain("events?.start()");
      expect(existsSync(join(dir, "flow.mjs"))).toBe(true);
    } finally {
      rmSync(join(root, "dist"), { recursive: true, force: true });
    }
  });
});
