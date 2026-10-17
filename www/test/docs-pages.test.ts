import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docsPagePaths } from "../scripts/docs-pages";

test("docs pages follow Fumadocs paths: groups are dropped and index is its folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-pages-"));
  try {
    for (const file of [
      "(brick)/index.mdx",
      "(brick)/quickstart.mdx",
      "(brick)/meta.json",
      "plugins/index.mdx",
      "plugins/audit.mdx",
      "api-reference/core.mdx",
    ]) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "");
    }
    expect(docsPagePaths(dir)).toEqual([
      "/docs",
      "/docs/api-reference/core",
      "/docs/plugins",
      "/docs/plugins/audit",
      "/docs/quickstart",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
