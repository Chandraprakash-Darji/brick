import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DIST_DIR, E2E_DIR, SRC_DIR, WF_BIN } from "./harness/paths.js";

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs,
    );
  }
  return newest;
}

/** Fingerprint of the built world, so a rebuild during the run is noticed. */
function distFingerprint(): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(DIST_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort()) {
    hash.update(name).update(readFileSync(join(DIST_DIR, name)));
  }
  return hash.digest("hex");
}

let fingerprintAtStart = "";

export function setup(): void {
  // 1. The workers load the world from dist/, so a stale dist tests old code.
  if (newestMtime(SRC_DIR) > statSync(join(DIST_DIR, "index.js")).mtimeMs) {
    throw new Error(
      "dist/ is older than src/: run `bun run build` first (`bun run test:e2e` does).",
    );
  }
  fingerprintAtStart = distFingerprint();
  console.log(
    `[e2e] testing dist/ fingerprint ${fingerprintAtStart.slice(0, 12)}`,
  );

  // 2. The `wf build` equivalent: bundle the fixture workflows into
  //    test/e2e/.well-known/workflow/v1/{flow.mjs,manifest.json}.
  const build = spawnSync(WF_BIN, ["build"], {
    cwd: E2E_DIR,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(
      `wf build failed (${build.status}):\n${build.stdout}\n${build.stderr}`,
    );
  }
}

export function teardown(): void {
  // Setup threw before fingerprinting: nothing to compare.
  if (fingerprintAtStart && distFingerprint() !== fingerprintAtStart) {
    throw new Error(
      "dist/ changed while the e2e suite was running; results are not trustworthy. Rerun.",
    );
  }
}
