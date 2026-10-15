import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApplication } from "./app-entry";
import { startNativeServer } from "./native-server";

export interface DevServerOptions {
  port?: number;
  entry?: string;
}

export async function startDevApplication(options: DevServerOptions) {
  if (!options.entry)
    throw new Error("Brick: an application entry is required.");
  return startNativeServer(await loadApplication(options.entry), options);
}

export const startProdServer = startDevApplication;

export async function startDevServer(options: DevServerOptions = {}) {
  const entry = options.entry;
  if (!entry) throw new Error("Brick: an application entry is required.");
  const resolvedEntry = resolve(entry);
  if (!existsSync(resolvedEntry)) {
    throw new Error(`Brick: entry not found: ${resolvedEntry}`);
  }

  const worker = new URL(
    import.meta.url.endsWith(".ts") ? "./dev-worker.ts" : "./dev-worker.js",
    import.meta.url,
  );
  let stopped = false;
  const intentionalExits = new WeakSet<ReturnType<typeof Bun.spawn>>();
  const launch = () => {
    const application = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(worker),
        resolvedEntry,
        String(options.port ?? ""),
      ],
      {
        cwd: process.cwd(),
        stdout: "inherit",
        stderr: "inherit",
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
