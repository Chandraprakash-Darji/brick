import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";
import { REDIS_SERVER_BIN } from "./paths.js";

/** First free TCP port at or above `from` (probed by binding it). */
export async function findFreePort(from: number): Promise<number> {
  for (let port = from; port < from + 200; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`no free port found from ${from}`);
}

/**
 * A redis-server process of the test's own, with AOF on so its state survives
 * a stop/start. Used by the restart scenarios; everything else shares the
 * scratch Redis.
 */
export class RedisServer {
  private proc: ChildProcess | undefined;
  readonly output: string[] = [];

  private constructor(
    readonly port: number,
    readonly dir: string,
  ) {}

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  static async start(): Promise<RedisServer> {
    const dir = await mkdtemp(join(tmpdir(), "wf-e2e-redis-"));
    const server = new RedisServer(await findFreePort(6396), dir);
    await server.spawn();
    return server;
  }

  private async spawn(): Promise<void> {
    const proc = spawn(
      REDIS_SERVER_BIN,
      [
        "--port",
        String(this.port),
        "--bind",
        "127.0.0.1",
        "--dir",
        this.dir,
        "--appendonly",
        "yes",
        // Every write is on disk before it is acknowledged, so a stop at any
        // instant (even SIGKILL) loses nothing the world was told succeeded.
        "--appendfsync",
        "always",
        "--save",
        "",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.proc = proc;
    proc.stdout?.on("data", (c) => this.output.push(String(c)));
    proc.stderr?.on("data", (c) => this.output.push(String(c)));
    await this.waitReady();
  }

  private async waitReady(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.proc && this.proc.exitCode !== null) {
        throw new Error(
          `redis-server exited early (${this.proc.exitCode}):\n${this.output.join("")}`,
        );
      }
      const client = new Redis(this.url, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      client.on("error", () => {});
      try {
        await client.connect();
        await client.ping();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      } finally {
        client.disconnect();
      }
    }
    throw new Error(`redis-server on ${this.port} did not become ready`);
  }

  /** Stop the process (SIGTERM = orderly shutdown with an AOF flush, SIGKILL = crash). */
  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise<void>((resolve) =>
      proc.once("exit", () => resolve()),
    );
    proc.kill(signal);
    await exited;
  }

  /** Start again on the same port and data directory (replays the AOF). */
  async startAgain(): Promise<void> {
    await this.spawn();
  }

  async restart(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    await this.stop(signal);
    await this.startAgain();
  }

  async dispose(): Promise<void> {
    await this.stop("SIGKILL");
    await rm(this.dir, { recursive: true, force: true });
  }
}
