import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { getGlobalRegistry, type Service } from "@elregaldo/core";
/** The native launcher also accepts a legacy worker for migration/testing. */
interface ExecutionWorker {
  readonly server: { port?: number } | null | undefined;
  listen(options: { port: number; hostname: string }): unknown;
  stop(closeActiveConnections?: boolean): unknown;
  nativeDocuments?(): Record<string, { contentType: string; body: string }>;
}
import type { CompiledPlans } from "./plans";

/** Rust owns the public listener; Bun remains a private custom-action worker. */
export async function startNativeHttp(app: ExecutionWorker, services: Service<any, any>[], plans: CompiledPlans,
  options: { port: number; prefix?: string; executable?: string }): Promise<void> {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("Native HTTP requires a port from 1 to 65535");
  if (JSON.parse(plans.sourceManifest).nativeResources === undefined) throw new Error("Run brick build --runtime rust to generate native HTTP plans");
  const databases: Record<string, string> = {};
  for (const plan of plans.nativeReads ?? []) {
    const service = services.find(s => s.name === plan.service)!;
    const filename = (service.getDb() as any)?.$client?.filename;
    if (!filename || filename === ":memory:") throw new Error(`Native resource '${plan.service}.${plan.resource}' requires file-backed SQLite`);
    databases[plan.service] = resolve(filename);
  }
  const directory = await mkdtemp(resolve(tmpdir(), "brick-http-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const originalStop = app.stop.bind(app);
  let stopping: Promise<any> | undefined;
  const stop = (...args: Parameters<typeof app.stop>) => stopping ??= (async () => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    if (child?.exitCode === null) child.kill();
    await child?.exited;
    try { if (app.server) return await originalStop(args[0] ?? true); }
    finally { await rm(directory, { recursive: true, force: true }); }
  })();
  const onSignal = () => { void stop().then(() => process.exit(0)); };
  try {
    await Bun.write(resolve(directory, "plans.json"), JSON.stringify(plans));
    await Bun.write(resolve(directory, "databases.json"), JSON.stringify(databases));
    await Bun.write(resolve(directory, "architecture.json"), JSON.stringify(getGlobalRegistry().exportArchitecture()));
    await Bun.write(resolve(directory, "documents.json"), JSON.stringify(app.nativeDocuments?.() ?? {}));
    app.listen({ port: 0, hostname: "127.0.0.1" });
    const privatePort = app.server?.port;
    if (!privatePort) throw new Error("Bun custom-action worker failed to listen");
    child = Bun.spawn([
      options.executable ?? process.env.BRICK_HTTP ?? "brick-http",
      "--plans", resolve(directory, "plans.json"), "--databases", resolve(directory, "databases.json"),
      "--architecture", resolve(directory, "architecture.json"),
      "--documents", resolve(directory, "documents.json"),
      "--upstream", `http://127.0.0.1:${privatePort}`, "--listen", `127.0.0.1:${options.port}`,
      "--prefix", options.prefix ?? "/api",
    ], { stdout: "inherit", stderr: "inherit" });
    // Install shutdown handlers before the public listener can become ready.
    app.stop = stop as typeof app.stop;
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Native HTTP exited with code ${child.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${options.port}/_health`, { signal: AbortSignal.timeout(300) });
        if (response.ok && response.headers.get("x-brick-runtime") === "rust") { ready = true; break; }
      } catch {}
      await Bun.sleep(50);
    }
    if (!ready) throw new Error("Native HTTP failed readiness check");
    void child.exited.then(code => {
      if (!stopping) { console.error(`[Brick-TS] Native HTTP exited (${code}); stopping Bun worker`); void stop(); }
    });
  } catch (error) { await stop(); throw error; }
}
