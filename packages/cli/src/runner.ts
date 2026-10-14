import { existsSync } from "fs";
import { watch } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "node:url";
import {
  brick,
  getPluginActionRoute,
  isBrickApp,
  type BrickApp,
} from "@brickkit/core";

export interface DevServerOptions {
  port?: number;
  entry?: string;
  prefix?: string;
}

async function createServer(
  options: DevServerOptions,
  label: string,
  application?: BrickApp,
) {
  let port: number;
  if (options.port !== undefined) {
    port = options.port;
  } else if (process.env.PORT !== undefined && process.env.PORT !== "") {
    port = Number(process.env.PORT);
  } else {
    port = 4000;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port: ${port}. Port must be an integer between 1 and 65535`,
    );
  }

  const app =
    application ??
    brick({
      port,
      prefix: options.prefix,
    });

  await app.listen({ port });

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

  const port =
    options.port !== undefined
      ? options.port
      : process.env.PORT !== undefined && process.env.PORT !== ""
        ? Number(process.env.PORT)
        : 4000;
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

export async function startDevApplication(options: DevServerOptions) {
  const module = options.entry
    ? await import(resolve(options.entry))
    : undefined;
  return createServer(
    options,
    "Development",
    isBrickApp(module?.default) ? module.default : undefined,
  );
}

export async function startDevServer(options: DevServerOptions = {}) {
  const entry = options.entry;
  if (!entry) return createServer(options, "Development");
  const resolvedEntry = resolve(entry);
  if (!existsSync(resolvedEntry)) {
    console.error(`[Brick-TS] Error: Entry file not found: ${resolvedEntry}`);
    process.exit(1);
  }

  const worker = new URL(
    import.meta.url.endsWith(".ts") ? "./dev-worker.ts" : "./dev-worker.js",
    import.meta.url,
  );
  const launch = () =>
    Bun.spawn(
      [
        process.execPath,
        fileURLToPath(worker),
        resolvedEntry,
        String(options.port ?? ""),
        options.prefix ?? "",
      ],
      {
        cwd: process.cwd(),
        stdout: "inherit",
        stderr: "inherit",
      },
    );
  let child = launch();
  const watchDirs = [
    ...new Set([resolve("src"), resolve("app"), resolve(resolvedEntry, "..")]),
  ].filter(existsSync);
  let pending: ReturnType<typeof setTimeout> | undefined;
  let restarting = false;
  let dirty = false;
  let stopped = false;

  async function restart() {
    dirty = true;
    if (restarting || stopped) return;
    restarting = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        console.log("\n📝 Changes detected. Restarting server...");
        child.kill();
        await child.exited;
        if (!stopped) child = launch();
      }
    } finally {
      restarting = false;
    }
  }

  const watchers = watchDirs.map((dir) =>
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename || filename.split(/[\\/]/).includes("node_modules")) return;
      clearTimeout(pending);
      pending = setTimeout(() => {
        void restart();
      }, 100);
    }),
  );
  const stop = () => {
    stopped = true;
    clearTimeout(pending);
    for (const watcher of watchers) watcher.close();
    child.kill();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("exit", stop);
  };
  const onSignal = () => {
    stop();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", stop);
  console.log(`\n👀 Watching for changes in: ${watchDirs.join(", ")}`);
  return { stop };
}
