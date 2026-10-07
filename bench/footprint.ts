#!/usr/bin/env bun
/** Cold process startup, idle CPU and runnable server bundle footprint. */
import { gzipSync } from "node:zlib";
import { brick } from "../packages/cli/src/server";
import { defineService } from "../packages/core/src";
import { collectManifest, writeJson, stamp } from "./lib/manifest";
import { median, parseArgs } from "./lib/stats";

const args = parseArgs(process.argv.slice(2));
if (args.child) {
  const service = defineService("footprint");
  service.action({ name: "ping", execute: () => ({ ok: true }) });
  const app = brick({ services: [service], requestLogging: false, docs: false });
  app.listen(0);
  console.log(JSON.stringify({ port: app.server!.port }));
  // Warm the first request, then measure this server process alone while idle.
  await fetch(`http://127.0.0.1:${app.server!.port}/_health`).then(response => response.text());
  const cpu = process.cpuUsage(), start = performance.now();
  await Bun.sleep(args.smoke ? 1000 : 5000);
  const elapsed = performance.now() - start, used = process.cpuUsage(cpu);
  const cpuMs = (used.user + used.system) / 1000;
  console.log(JSON.stringify({ idle_cpu_ms: cpuMs, idle_cpu_percent: cpuMs / elapsed * 100, idle_window_ms: elapsed }));
  await app.stop();
} else {
  const samples = [];
  for (let i = 0; i < (args.smoke ? 2 : 5); i++) {
    const start = performance.now();
    const child = Bun.spawn([process.execPath, import.meta.path, "--child", ...(args.smoke ? ["--smoke"] : [])], { stdout: "pipe", stderr: "inherit" });
    const reader = child.stdout.getReader();
    let text = "", ready = false, startupMs = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
      if (!ready && text.includes("\n")) { startupMs = performance.now() - start; ready = true; }
    }
    if (await child.exited !== 0 || !ready) throw new Error("Footprint server failed");
    const idle = JSON.parse(text.trim().split("\n").at(-1)!);
    samples.push({ startup_ms: startupMs, ...idle });
  }
  const build = await Bun.build({ entrypoints: ["examples/showcase/src/server.ts"], target: "bun", minify: true, sourcemap: "none" });
  if (!build.success) throw new AggregateError(build.logs, "Bundle benchmark failed");
  let bytes = 0, gzipBytes = 0;
  for (const output of build.outputs) { const buffer = new Uint8Array(await output.arrayBuffer()); bytes += buffer.length; gzipBytes += gzipSync(buffer).length; }
  const summary = {
    startup_ms: median(samples.map(row => row.startup_ms)),
    idle_cpu_ms: median(samples.map(row => row.idle_cpu_ms)),
    idle_cpu_percent: median(samples.map(row => row.idle_cpu_percent)),
    bundle_bytes: bytes, bundle_gzip_bytes: gzipBytes,
  };
  console.log(summary);
  console.log(await writeJson(`footprint-${stamp()}.json`, { manifest: collectManifest({ benchmark: "footprint", db: "none" }), samples, summary,
    bundle: "examples/showcase/src/server.ts; minified Bun target; dependencies bundled; Bun built-ins external", idle_window_ms: args.smoke ? 1000 : 5000 }));
}
