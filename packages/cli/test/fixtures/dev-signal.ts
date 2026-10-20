import { startDevServer } from "../../src/runner";

await startDevServer({
  entry: new URL("./events-dev-signal.ts", import.meta.url).pathname,
  port: Number(process.argv[2]),
  dashboard: false,
});
