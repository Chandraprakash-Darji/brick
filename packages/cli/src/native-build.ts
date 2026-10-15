import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { NativeBrickApp } from "@brickkit/core";

export async function buildNativeApplication(
  options: { entry: string; outdir?: string; port: number },
  app: NativeBrickApp,
) {
  const entry = resolve(options.entry);
  const outdir = resolve(options.outdir ?? "dist/brick");
  await mkdir(dirname(outdir), { recursive: true });
  const staging = await mkdtemp(join(dirname(outdir), ".brick-native-build-"));
  try {
    await Bun.write(
      join(staging, "entry.ts"),
      `import app from ${JSON.stringify(entry)};
export { app };
if (import.meta.main) {
  const port = Number(process.env.PORT ?? ${options.port});
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT: must be between 1 and 65535");
  let server;
  try {
    await app.ready();
    server = Bun.serve({ port, fetch: request => app.fetch(request) });
  } catch (error) {
    await app.dispose();
    throw error;
  }
  let closing;
  const stop = () => closing ??= (async () => {
    try { await server.stop(true); } finally { await app.dispose(); }
  })();
  const onSignal = () => void stop().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  console.log("Brick server listening on http://localhost:" + server.port);
}
`,
    );
    const result = await Bun.build({
      entrypoints: [join(staging, "entry.ts")],
      target: "bun",
      format: "esm",
      outdir: staging,
      naming: "server.js",
      sourcemap: "external",
    });
    if (!result.success)
      throw new AggregateError(
        result.logs,
        "Brick: native application bundling failed",
      );
    const services = app.services.map((service) => ({
      name: service.name,
      actions: Object.values(service.actions).map((action) => ({
        name: action.endpoint.identifier,
        method: action.method,
        path: action.path,
      })),
    }));
    const ir = {
      version: 2 as const,
      target: "effect-http-api" as const,
      services,
      routes: services.flatMap((service) =>
        service.actions.map((action) => ({ service: service.name, ...action })),
      ),
      diagnostics: [],
    };
    await Bun.write(
      join(staging, "brick-ir.json"),
      JSON.stringify(ir, null, 2) + "\n",
    );
    await mkdir(outdir, { recursive: true });
    for (const name of ["brick-ir.json", "server.js.map", "server.js"])
      await rename(join(staging, name), join(outdir, name));
    return { outdir, entry: join(outdir, "server.js"), ir };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
