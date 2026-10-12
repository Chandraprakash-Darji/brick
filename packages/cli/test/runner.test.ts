import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetGlobalRegistry } from "@brickkit/core";
import { startDevServer } from "../src/runner";
import { existsSync } from "fs";
import path from "path";

describe("startDevServer", () => {
  let exitCode: number | null = null;
  let errorOutput: string[] = [];
  let originalExit: any;
  let originalError: any;

  beforeEach(() => {
    resetGlobalRegistry();
    exitCode = null;
    errorOutput = [];

    // Mock process.exit to prevent actual exit
    originalExit = process.exit;
    (process.exit as any) = (code: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };

    // Mock console.error to capture error messages
    originalError = console.error;
    console.error = (...args: any[]) => {
      errorOutput.push(args.join(" "));
      originalError(...args);
    };
  });

  afterEach(() => {
    // Restore original functions
    process.exit = originalExit;
    console.error = originalError;
  });

  it("should start server without entry when no entry is provided", async () => {
    const app = await startDevServer({ port: 45111 });
    expect(app).toBeDefined();
    expect(exitCode).toBeNull();
  });

  it("should fail with non-zero exit code when entry is provided but not found", async () => {
    try {
      await startDevServer({ entry: "does-not-exist.ts", port: 45112 });
    } catch {
      // Expected to throw due to mocked process.exit
    }

    expect(exitCode).toBe(1);
    expect(errorOutput.length).toBeGreaterThan(0);
    expect(errorOutput[0]).toContain("Entry file not found");
    expect(errorOutput[0]).toContain("does-not-exist.ts");
  });

  it("should load valid entry file successfully", async () => {
    const timestamp = Date.now();
    const filename = `.test-entry-${timestamp}.ts`;
    const entryPath = path.join(process.cwd(), filename);
    const content = "console.log('Entry loaded');";

    await Bun.write(entryPath, content);

    try {
      const app = await startDevServer({ entry: filename, port: 45113 });
      expect(app).toBeDefined();
      expect(exitCode).toBeNull();
    } finally {
      if (existsSync(entryPath)) {
        Bun.file(entryPath).delete();
      }
    }
  });
});
