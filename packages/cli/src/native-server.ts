import type { NativeBrickApp } from "@brickkit/core";
import { parsePort } from "./port-utils";

export interface NativeServer {
  readonly app: NativeBrickApp;
  readonly server: Bun.Server<undefined>;
  stop(): Promise<void>;
}

export async function startNativeServer(
  app: NativeBrickApp,
  options: { port?: number } = {},
): Promise<NativeServer> {
  let server: Bun.Server<undefined>;
  try {
    const port = parsePort(
      options.port === undefined ? undefined : String(options.port),
      process.env.PORT,
    );
    await app.ready();
    server = Bun.serve({ port, fetch: (request) => app.fetch(request) });
  } catch (error) {
    await app.dispose();
    throw error;
  }
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= (async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      try {
        await server.stop(true);
      } finally {
        await app.dispose();
      }
    })());
  const onSignal = () => {
    void stop().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  console.log(`\n⚡ API Gateway running on: http://localhost:${server.port}`);
  console.log(
    `🩺 Health check:        http://localhost:${server.port}/_health`,
  );
  console.log(
    `🗺️ Architecture graph:  http://localhost:${server.port}/_brick/services\n`,
  );
  return { app, server, stop };
}
