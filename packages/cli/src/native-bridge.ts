import { createRequire } from "node:module";
import { resolve } from "node:path";
import { getGlobalRegistry, type Service } from "@elregaldo/core";
import type { CompiledPlans } from "./plans";
import type { NativeWorker } from "./native-worker";
import type { BridgeRequest, BridgeResponse } from "./bridge-types";
interface NativeHandle { port: number; stop(): Promise<void> }
interface NativeAddon {
  startInProcess(config: string, listen: string, callback: (error: Error | null, request: BridgeRequest) => Promise<BridgeResponse>): Promise<NativeHandle>;
}

/** Rust HTTP + JS callbacks in one Bun process, without a private HTTP listener. */
export async function startInProcessHttp(app: NativeWorker, services: Service<any, any>[], plans: CompiledPlans,
  options: { port: number; prefix?: string; addon?: string }) {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error("Invalid native HTTP port");
  if (JSON.parse(plans.sourceManifest).nativeResources === undefined) throw new Error("Run brick build --runtime rust first");
  const databases: Record<string, string> = {};
  for (const plan of plans.nativeReads ?? []) {
    const filename = (services.find(s => s.name === plan.service)!.getDb() as any)?.$client?.filename;
    if (!filename || filename === ":memory:") throw new Error(`Native resource '${plan.service}.${plan.resource}' requires file-backed SQLite`);
    databases[plan.service] = resolve(filename);
  }
  const path = resolve(options.addon ?? process.env.BRICK_HTTP_ADDON ?? "native/brick-http/target/release/brick-http.node");
  let addon: NativeAddon;
  try { addon = createRequire(import.meta.url)(path); }
  catch (error) { throw new Error(`Unable to load Rust HTTP addon at ${path}; run bun run build:native-http or set BRICK_HTTP_ADDON`, { cause: error }); }
  const handle = await addon.startInProcess(JSON.stringify({ plans: JSON.stringify(plans), databases: JSON.stringify(databases),
    architecture: JSON.stringify(getGlobalRegistry().exportArchitecture()), documents: JSON.stringify(app.nativeDocuments()),
    prefix: options.prefix ?? "/api", bindings: app.nativeBindings() }), `127.0.0.1:${options.port}`, async (error, request) => {
    if (error) throw error;
    return app.dispatchBridge(request);
  });
  app.attachNativePort(handle.port);
  const originalStop = app.stop.bind(app);
  let stopping: Promise<any> | undefined;
  const onSignal = () => { void stop().then(() => process.exit(0)); };
  const stop = () => stopping ??= (async () => {
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
    await handle.stop(); app.attachNativePort(undefined);
    return originalStop();
  })();
  app.stop = stop;
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  return app;
}
