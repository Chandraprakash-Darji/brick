import { existsSync } from "fs";
import { watch } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "node:url";
import {
  brick,
  getPluginActionRoute,
  isBrickApp,
  type ApiDocument,
  type ArchitectureSchema,
  type BrickApp,
  type DocumentationOptions,
} from "@brickkit/core";
import { startDevDashboard, type DevDashboard } from "./dev-dashboard";
import { DocsHost } from "./dev-docs";
import { DEFAULT_HISTORY_DAYS, openHistory } from "./dev-history";
import { DevTelemetryStore } from "./dev-telemetry-store";
import { parsePort } from "./port-utils";
import { startProductionDashboard } from "./production-dashboard";
import type {
  SerializedError,
  TelemetryRecord,
  WorkerErrorPhase,
} from "./dev-telemetry";

export interface DevServerOptions {
  port?: number;
  entry?: string;
  prefix?: string;
  /** Generate a browser contract before starting the backend and frontend. */
  clientOutput?: string;
  /** Frontend command, launched once after the first successful generation. */
  frontend?: string;
  /**
   * Local dashboard with live requests, traces, errors, and reloads. Needs an
   * entry. `historyDays` is how long finished requests are kept on disk
   * (default 90); zero keeps live data only.
   */
  dashboard?: { port: number; historyDays?: number } | false;
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

  let exported: BrickApp | undefined;
  if (entry) {
    const resolvedEntry = resolve(process.cwd(), entry);
    if (!existsSync(resolvedEntry)) {
      console.error(`[Brick-TS] Error: Entry file not found: ${resolvedEntry}`);
      process.exit(1);
    }
    console.log(`[Brick-TS] Loading application entry: ${resolvedEntry}`);
    const module = await import(resolvedEntry);
    // An entry that default-exports its app is served as it built it, with its
    // options (telemetry, dashboard, and the rest), as `brick dev` does.
    if (isBrickApp(module?.default)) exported = module.default;
  }
  if (exported && options.prefix !== undefined) {
    console.warn(
      `[Brick-TS] Ignoring prefix ${options.prefix}: exported BrickApp prefix ${exported.definition.prefix} takes precedence.`,
    );
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

  const app =
    exported ??
    brick({
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

  // Before listening, so the first request is already traced and its logs kept.
  const dashboard = await startProductionDashboard(app, { appPort: port });
  app.listen(port);

  console.log(`\n⚡ API Gateway running on: http://localhost:${port}`);
  console.log(`🩺 Health check:        http://localhost:${port}/_health`);
  if (dashboard) {
    const shown =
      dashboard.host === "0.0.0.0" || dashboard.host === "::"
        ? "localhost"
        : dashboard.host.includes(":")
          ? `[${dashboard.host.replace(/^\[|\]$/g, "")}]`
          : dashboard.host;
    console.log(
      `📊 Dashboard:           http://${shown}:${dashboard.port} (health: /_health)`,
    );
  }
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
  if (
    options.dashboard &&
    options.port !== undefined &&
    options.dashboard.port === options.port
  )
    throw new Error(
      "Brick: dashboard port must differ from the API port. Use --dashboard-port <number>.",
    );
  // The worker resolves its port the same way, so this is where the app listens.
  const appPort = () =>
    parsePort(
      options.port === undefined ? undefined : String(options.port),
      process.env.PORT,
    );
  const history = options.dashboard
    ? await openHistory({
        directory: process.cwd(),
        days: options.dashboard.historyDays ?? DEFAULT_HISTORY_DAYS,
        warn: (message) => console.warn(message),
      })
    : undefined;
  const telemetry = options.dashboard
    ? new DevTelemetryStore({ history })
    : undefined;
  const docs = telemetry
    ? new DocsHost(telemetry, (message) => console.warn(message))
    : undefined;
  let frontend: ReturnType<typeof Bun.spawn> | undefined;
  const dependencyFiles = new Set<string>();
  const dependencyWatchers = new Map<string, ReturnType<typeof watch>>();
  let stopped = false;
  const intentionalExits = new WeakSet<ReturnType<typeof Bun.spawn>>();
  let generationCount = 0;
  let childGeneration = 0;
  const launch = () => {
    const generation = ++generationCount;
    childGeneration = generation;
    telemetry?.recordReload({ kind: "started", generation });
    const application = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(worker),
        resolvedEntry,
        String(options.port ?? ""),
        options.prefix ?? "",
        options.clientOutput ? resolve(options.clientOutput) : "",
        telemetry ? "1" : "",
      ],
      {
        cwd: process.cwd(),
        stdout: "inherit",
        stderr: "inherit",
        ipc(message) {
          if (!message || typeof message !== "object" || !("type" in message))
            return;
          if (
            telemetry &&
            message.type === "brick:telemetry" &&
            "records" in message &&
            Array.isArray(message.records)
          ) {
            telemetry.ingest(message.records as TelemetryRecord[], generation);
          }
          if (
            telemetry &&
            message.type === "brick:error" &&
            "phase" in message &&
            "error" in message
          ) {
            telemetry.recordWorkerError(
              message.phase as WorkerErrorPhase,
              message.error as SerializedError,
              generation,
            );
          }
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
            telemetry &&
            message.type === "brick:architecture" &&
            "architecture" in message
          ) {
            telemetry.setArchitecture(
              message.architecture as ArchitectureSchema,
              generation,
            );
          }
          if (docs && message.type === "brick:documentation") {
            void docs.configure(
              dirname(resolvedEntry),
              "documentation" in message
                ? (message.documentation as DocumentationOptions | undefined)
                : undefined,
            );
          }
          if (
            telemetry &&
            message.type === "brick:api-documents" &&
            "documents" in message &&
            Array.isArray(message.documents)
          ) {
            telemetry.setApiDocuments(
              message.documents as ApiDocument[],
              `http://localhost:${appPort()}`,
            );
          }
          if (telemetry && message.type === "brick:contract-ready") {
            telemetry.recordReload({
              kind: "contract-ready",
              generation,
              detail: "browser contract generated",
            });
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
        telemetry?.recordReload({
          kind: "exited",
          generation,
          detail: `exit code ${code}`,
        });
      }
      telemetry?.interruptGeneration(generation);
    });
    return application;
  };
  // Bind the dashboard before the first worker starts, so a port conflict
  // does not leave an application process running.
  const dashboard: DevDashboard | undefined =
    telemetry && options.dashboard
      ? await startDevDashboard({
          port: options.dashboard.port,
          store: telemetry,
          history,
          docs: () => docs?.current,
          restart: () => {
            void restart("dashboard");
          },
        }).catch((error: unknown) => {
          history?.close();
          throw error;
        })
      : undefined;
  if (dashboard) {
    console.log(`📊 Dev dashboard:       http://127.0.0.1:${dashboard.port}`);
  }
  let child = launch();
  const watchDirs = [
    ...new Set([resolve("src"), resolve("app"), resolve(resolvedEntry, "..")]),
  ].filter(existsSync);
  let pending: ReturnType<typeof setTimeout> | undefined;
  let restarting = false;
  let dirty = false;

  async function restart(trigger: "changes" | "dashboard" = "changes") {
    dirty = true;
    if (restarting || stopped) return;
    restarting = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        console.log(
          trigger === "changes"
            ? "\n📝 Changes detected. Restarting server..."
            : "\n🔄 Restart requested from the dashboard. Restarting server...",
        );
        telemetry?.recordReload({
          kind: "restarting",
          generation: childGeneration,
          detail:
            trigger === "changes" ? "source changed" : "restart from dashboard",
        });
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
    dashboard?.stop();
    docs?.close();
    history?.close();
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
