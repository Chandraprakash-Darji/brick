import { existsSync } from "fs";
import { watch } from "fs";
import { resolve } from "path";
import {
  brick,
  getPluginActionRoute,
  resetGlobalRegistry,
} from "@brickkit/core";

export interface DevServerOptions {
  port?: number;
  entry?: string;
  prefix?: string;
}

let currentServer: any = null;

async function closeServer() {
  if (currentServer) {
    try {
      await currentServer.stop?.();
      currentServer = null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (err) {
      console.error("Error closing server:", err);
    }
  }
}

async function createServer(options: DevServerOptions, label: string) {
  const port = options.port ?? (Number(process.env.PORT) || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port: ${port}. Port must be an integer between 1 and 65535`,
    );
  }

  const app = brick({
    port,
    prefix: options.prefix,
  });

  currentServer = await app.listen({ port });

  const prefix = app.definition.prefix;
  const services = app.definition.services;

  console.log(`\n🧱 Brick-TS ${label} Server`);
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

  console.log(`\n⚡ API Gateway running on: http://localhost:${port}`);
  console.log(`🩺 Health check:        http://localhost:${port}/_health`);
  console.log(
    `🗺️ Architecture graph:  http://localhost:${port}/_brick/services\n`,
  );

  return app;
}

export async function startProdServer(options: DevServerOptions = {}) {
  const entry = options.entry;

  if (entry) {
    const resolvedEntry = resolve(process.cwd(), entry);
    if (!existsSync(resolvedEntry)) {
      console.error(`[Brick-TS] Error: Entry file not found: ${resolvedEntry}`);
      process.exit(1);
    }
    console.log(`[Brick-TS] Loading application entry: ${resolvedEntry}`);
    await import(resolvedEntry);
  }

  const port = options.port ?? (Number(process.env.PORT) || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port: ${port}. Port must be an integer between 1 and 65535`,
    );
  }

  const app = brick({
    port,
    prefix: options.prefix,
  });

  const prefix = app.definition.prefix;
  const services = app.definition.services;

  console.log(`\n🧱 Brick-TS Production Server`);
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

export async function startDevServer(options: DevServerOptions = {}) {
  const entry = options.entry;

  if (entry) {
    const resolvedEntry = resolve(process.cwd(), entry);
    if (!existsSync(resolvedEntry)) {
      console.error(`[Brick-TS] Error: Entry file not found: ${resolvedEntry}`);
      process.exit(1);
    }
    console.log(`[Brick-TS] Loading application entry: ${resolvedEntry}`);
    await import(resolvedEntry);
  }

  await createServer(options, "Development");

  const cwd = process.cwd();
  const watchDirs = [
    resolve(cwd, "src"),
    resolve(cwd, "app"),
    entry ? resolve(cwd, entry).replace(/\/[^/]+$/, "") : null,
  ].filter(Boolean) as string[];

  let isRestarting = false;

  for (const dir of watchDirs) {
    if (!existsSync(dir)) continue;

    watch(dir, { recursive: true }, async (eventType, filename) => {
      if (!filename || filename.includes("node_modules") || isRestarting)
        return;

      isRestarting = true;

      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log(`\n📝 Changes detected in ${filename}. Restarting server...`);

      try {
        await closeServer();
        resetGlobalRegistry();

        if (entry) {
          const resolvedEntry = resolve(process.cwd(), entry);
          if (existsSync(resolvedEntry)) {
            await import(resolvedEntry);
          }
        }

        await createServer(options, "Development");
      } catch (err) {
        console.error("Error restarting server:", err);
        isRestarting = false;
        return;
      }

      isRestarting = false;
    });
  }

  console.log(`\n👀 Watching for changes in: ${watchDirs.join(", ")}`);
}
