import { existsSync } from "fs";
import { resolve } from "path";
import { brick, getPluginActionRoute } from "@brickkit/core";

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

  const app = brick({
    port,
    prefix: options.prefix,
  });

  const prefix = app.definition.prefix;
  const services = app.definition.services;

  console.log(`\n🧱 Brick-TS Development Server`);
  console.log(`   Registered Services: ${services.length}`);

  for (const svc of services) {
    const actions = svc.listActions();
    console.log(`   • ${svc.name} (${actions.length} actions)`);
    for (const act of actions) {
      const pluginRoute = getPluginActionRoute(act, prefix);
      if (pluginRoute === false) continue;
      const method = pluginRoute?.method ?? act.config.method ?? "POST";
      const path =
        pluginRoute?.path ??
        act.config.path ??
        `${prefix}/${svc.name}/${act.name}`;
      console.log(`     -> ${method.padEnd(6)} ${path}`);
    }
  }

  app.listen(port);

  console.log(`\n⚡ API Gateway running on: http://localhost:${port}`);
  console.log(`🩺 Health check:        http://localhost:${port}/_health`);
  console.log(
    `🗺️ Architecture graph:  http://localhost:${port}/_brick/services\n`,
  );

  return app;
}
