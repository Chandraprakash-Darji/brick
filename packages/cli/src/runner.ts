import { existsSync } from "fs";
import { resolve } from "path";
import { getGlobalRegistry } from "@brick/core";
import { createBrickServer } from "./server";

export interface DevServerOptions {
  port?: number;
  entry?: string;
  prefix?: string;
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
      console.warn(`[Brick-TS] Specified entry not found: ${resolvedEntry}`);
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

  const app = createBrickServer({
    port,
    prefix: options.prefix,
  });

  app.listen(port);

  console.log(`\n⚡ API Gateway running on: http://localhost:${port}`);
  console.log(`🩺 Health check:        http://localhost:${port}/_health`);
  console.log(`🗺️ Architecture graph:  http://localhost:${port}/_brick/services\n`);

  return app;
}
