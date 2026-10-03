#!/usr/bin/env bun
import { startDevServer } from "./runner";
import { getGlobalRegistry } from "@brick-ts/core";

const args = process.argv.slice(2);
const command = args[0] || "dev";

async function main() {
  switch (command) {
    case "dev":
    case "start": {
      const entry = args[1];
      const portArgIdx = args.indexOf("--port");
      const port = portArgIdx !== -1 ? Number(args[portArgIdx + 1]) : 4000;

      await startDevServer({ entry, port });
      break;
    }

    case "info":
    case "services": {
      const registry = getGlobalRegistry();
      console.log(JSON.stringify(registry.exportArchitecture(), null, 2));
      break;
    }

    default:
      console.log(`
🧱 Brick-TS CLI

Usage:
  brick dev [entry] [--port <number>]   Start development server
  brick start [entry]                  Start production server
  brick info                           Export architecture JSON schema
`);
      process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
