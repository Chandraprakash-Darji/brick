import { existsSync } from "fs";
import { watch } from "fs";
import { resolve, dirname, basename } from "path";
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
  /** Generate a browser contract before starting the backend and frontend. */
  clientOutput?: string;
  /** Frontend command, launched once after the first successful generation. */
  frontend?: string;
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
  if (isBrickApp(module?.default) && options.prefix !== undefined) {
    console.warn(
      `[Brick-TS] Ignoring prefix ${options.prefix}: exported BrickApp prefix ${module.default.definition.prefix} takes precedence.`,
    );
  }
  if (options.clientOutput) {
    if (!isBrickApp(module?.default))
      throw new Error(
        "Brick: client generation requires a default-exported BrickApp.",
      );
    const { generateClientContract } = await import("./client-contract");
    const { writeContractSource } = await import("./client-contract-file");
    const { requireBrickApp } = await import("./app-entry");
    const output = resolve(options.clientOutput);
    if (output === resolve(options.entry!))
      throw new Error(
        "Brick: contract output must not overwrite the app entry.",
      );
    await writeContractSource(
      output,
      generateClientContract(requireBrickApp(module.default)),
    );
    process.send?.({ type: "brick:contract-ready" });
  }
  return createServer(
    options,
    "Development",
    isBrickApp(module?.default) ? module.default : undefined,
  );
}

export async function startDevServer(options: DevServerOptions = {}) {
  const entry = options.entry;
  if (!entry && (options.clientOutput || options.frontend))
    throw new Error("Brick: --client and --frontend require an app entry.");
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
  if (options.frontend && !options.clientOutput)
    throw new Error("Brick: --frontend requires --client <file>.");
  let frontend: ReturnType<typeof Bun.spawn> | undefined;
  const dependencyFiles = new Set<string>();
  const dependencyWatchers = new Map<string, ReturnType<typeof watch>>();
  let stopped = false;
  const intentionalExits = new WeakSet<ReturnType<typeof Bun.spawn>>();
  const launch = () => {
    const application = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(worker),
        resolvedEntry,
        String(options.port ?? ""),
        options.prefix ?? "",
        options.clientOutput ? resolve(options.clientOutput) : "",
      ],
      {
        cwd: process.cwd(),
        stdout: "inherit",
        stderr: "inherit",
        ipc(message) {
          if (!message || typeof message !== "object" || !("type" in message))
            return;
          if (
            message.type === "brick:contract-ready" &&
            options.frontend &&
            !frontend &&
            !stopped
          ) {
            frontend = Bun.spawn(
              [process.env.SHELL ?? "/bin/sh", "-c", options.frontend],
              {
                detached: true,
                cwd: process.cwd(),
                stdout: "inherit",
                stderr: "inherit",
              },
            );
          }
          if (
            message.type === "brick:dependencies" &&
            "files" in message &&
            Array.isArray(message.files)
          ) {
            for (const file of message.files) {
              if (
                typeof file !== "string" ||
                file === resolve(options.clientOutput ?? "_brick/contract.ts")
              )
                continue;
              dependencyFiles.add(file);
              const directory = dirname(file);
              if (!dependencyWatchers.has(directory))
                dependencyWatchers.set(
                  directory,
                  watch(directory, (_event, filename) => {
                    if (
                      !filename ||
                      !dependencyFiles.has(resolve(directory, filename))
                    )
                      return;
                    scheduleRestart();
                  }),
                );
            }
          }
        },
      },
    );
    void application.exited.then((code) => {
      if (!stopped && !intentionalExits.has(application)) {
        console.error(
          `[Brick-TS] Application process exited with code ${code}. Waiting for changes to restart.`,
        );
      }
    });
    return application;
  };
  let child = launch();
  const watchDirs = [
    ...new Set([resolve("src"), resolve("app"), resolve(resolvedEntry, "..")]),
  ].filter(existsSync);
  let pending: ReturnType<typeof setTimeout> | undefined;
  let restarting = false;
  let dirty = false;

  async function restart() {
    dirty = true;
    if (restarting || stopped) return;
    restarting = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        console.log("\n📝 Changes detected. Restarting server...");
        intentionalExits.add(child);
        child.kill();
        await child.exited;
        if (!stopped) child = launch();
      }
    } finally {
      restarting = false;
    }
  }

  function scheduleRestart() {
    clearTimeout(pending);
    pending = setTimeout(() => {
      void restart();
    }, 100);
  }
  const watchers = watchDirs.map((dir) =>
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename || filename.split(/[\\/]/).includes("node_modules")) return;
      const file = resolve(dir, filename);
      if (
        file === resolve(options.clientOutput ?? "_brick/contract.ts") ||
        basename(file).startsWith(".brick-contract-")
      )
        return;
      scheduleRestart();
    }),
  );
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(pending);
    for (const watcher of watchers) watcher.close();
    for (const watcher of dependencyWatchers.values()) watcher.close();
    if (frontend) {
      if (process.platform === "win32") {
        Bun.spawnSync(["taskkill", "/pid", String(frontend.pid), "/t", "/f"]);
      } else {
        try {
          process.kill(-frontend.pid, "SIGTERM");
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ESRCH"
            )
          )
            throw error;
        }
      }
    }
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
