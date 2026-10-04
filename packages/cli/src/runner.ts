import { startInProcessHttp } from "./native-bridge";
import { startNativeHttp } from "./native";
import { compilePlans, loadPlans } from "./plans";
import { existsSync } from "fs";
import { resolve } from "path";
import { getGlobalRegistry } from "@elregaldo/core";
import { createNativeWorker } from "./native-worker";

export interface DevServerOptions {
  port?: number;
  entry?: string;
  prefix?: string;
  plans?: "compile" | "load";
  plansPath?: string;
  compiler?: string;
  runtime?: "bun" | "rust";
  nativeExecutable?: string;
  nativeBridge?: "inprocess" | "http";
  nativeAddon?: string;
}

export async function startDevServer(options: DevServerOptions = {}) {
  const port = options.port ?? (Number(process.env.PORT) || 4000);
  const entry = options.entry;

  if (entry) {
    const resolvedEntry = resolve(process.cwd(), entry);
    if (existsSync(resolvedEntry)) {
      console.log(`[Brick-TS] Loading application entry: ${resolvedEntry}`);
      await import(resolvedEntry);
    } else {
      throw new Error(`[Brick-TS] Specified entry not found: ${resolvedEntry}`);
    }
  }

  const registry = getGlobalRegistry();
  const services = registry.list();

  console.log(`\n🧱 Brick-TS Development Server`);
  console.log(`   Registered Services: ${services.length}`);

  for (const svc of services) {
    console.log(`   • ${svc.name} (${svc.listActions().length} actions)`);
    if (typeof (svc as any).listResources === "function") {
      for (const res of (svc as any).listResources()) {
        console.log(`     -> Resource: /api/${res.name} (REST: GET, POST, /:id: GET, PATCH, DELETE)`);
      }
    }
    for (const act of svc.listActions()) {
      console.log(`     -> Action:   /api/${svc.name}/${act.name}`);
    }
  }

  const plansPath = options.plansPath ?? ".brick/plans.json";
  const plans = options.plans === "compile"
    ? await compilePlans(services, { compiler: options.compiler, output: plansPath, native: options.runtime === "rust" })
    : options.plans === "load" ? await loadPlans(plansPath) : undefined;

  const serverOptions = { services, plans, port, prefix: options.prefix };
  let app;
  if (options.runtime === "rust") {
    if (!plans) throw new Error("Native HTTP requires compiled plans");
    app = createNativeWorker(serverOptions);
    if (options.nativeBridge === "http") await startNativeHttp(app, services, plans, { port, prefix: options.prefix, executable: options.nativeExecutable });
    else await startInProcessHttp(app, services, plans, { port, prefix: options.prefix, addon: options.nativeAddon });
  } else {
    const { createBrickServer } = await import("./server");
    app = createBrickServer(serverOptions);
    app.listen(port);
  }

  console.log(`\n⚡ API Gateway running on: http://localhost:${port}`);
  console.log(`🩺 Health check:        http://localhost:${port}/_health`);
  console.log(`🗺️ Architecture graph:  http://localhost:${port}/_brick/services\n`);

  return app;
}
