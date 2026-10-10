import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { compileBrickApplication, emitCompiledApplication } from "./compiler";
import { aot } from "elysia/plugin/aot/bun";
import { loadBrickApp } from "./app-entry";

export interface BuildApplicationOptions {
  /** A module whose default export is a BrickApp, without starting a server. */
  entry: string;
  outdir?: string;
  port?: number;
  /** Precompile Elysia's HTTP handlers at build time (default true). */
  aot?: boolean;
}

/** Bundle an exported BrickApp with generated handlers and its original configuration. */
export async function buildApplication(options: BuildApplicationOptions) {
  const entry = resolve(options.entry);
  if (!(await Bun.file(entry).exists()))
    throw new Error(`Brick compiler: entry not found: ${entry}`);
  const outdir = resolve(options.outdir ?? "dist/brick");
  if (
    entry === join(outdir, "server.js") ||
    entry === join(outdir, "routes.js")
  )
    throw new Error(
      "Brick compiler: output would overwrite the application entry",
    );
  const port = options.port ?? 4000;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(
      "Brick compiler: port must be an integer between 0 and 65535",
    );
  const app = await loadBrickApp(entry);
  const services = [...app.definition.services];
  const compilation = compileBrickApplication({
    services,
    prefix: app.definition.prefix,
  });
  await mkdir(dirname(outdir), { recursive: true });
  const staging = await mkdtemp(join(dirname(outdir), ".brick-build-"));
  try {
    await Bun.write(
      join(staging, "routes.js"),
      emitCompiledApplication(compilation.ir),
    );
    const source = `import { loadCompiledBrickApp } from "@brickkit/cli/compiler";
import { ir, bind } from "./routes.js";
export const app = await loadCompiledBrickApp(() => import(${JSON.stringify(entry)}), ir, bind);
if (import.meta.main) {
  const port = Number(process.env.PORT ?? ${port});
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
  app.listen(port);
  console.log("Brick compiled server listening on http://localhost:" + app.server.port);
  const stop = async () => { await app.stop(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
`;
    await Bun.write(join(staging, "entry.ts"), source);
    const result = await Bun.build({
      entrypoints: [join(staging, "entry.ts")],
      target: "bun",
      format: "esm",
      outdir: staging,
      naming: "server.js",
      sourcemap: "external",
      plugins:
        options.aot === false
          ? []
          : [aot(join(staging, "entry.ts"), { target: "bun", strip: true })],
    });
    if (!result.success)
      throw new AggregateError(result.logs, "Brick compiler: bundling failed");
    await Bun.write(
      join(staging, "brick-ir.json"),
      JSON.stringify(compilation.ir, null, 2) + "\n",
    );
    await mkdir(outdir, { recursive: true });
    for (const name of [
      "routes.js",
      "brick-ir.json",
      "server.js.map",
      "server.js",
    ])
      await rename(join(staging, name), join(outdir, name));
    return { outdir, entry: join(outdir, "server.js"), ir: compilation.ir };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
