#!/usr/bin/env bun
import { compilePlans } from "./plans";
import { resolve } from "node:path";
import { startDevServer } from "./runner";
import { getGlobalRegistry, generateOpenApiSpec } from "@elregaldo/core";

const args = process.argv.slice(2);
const command = args[0] || "dev";
const bridgeIdx = args.indexOf("--bridge");
const bridge = bridgeIdx === -1 ? "inprocess" : args[bridgeIdx + 1];
const runtimeIdx = args.indexOf("--runtime");
const runtime = runtimeIdx === -1 ? "bun" : args[runtimeIdx + 1];

async function main() {
  if (runtime !== "bun" && runtime !== "rust") throw new Error("--runtime must be bun or rust");
  if (bridge !== "inprocess" && bridge !== "http") throw new Error("--bridge must be inprocess or http");
  switch (command) {
    case "dev":
    case "start": {
      const entry = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      const portArgIdx = args.indexOf("--port");
      const port = portArgIdx !== -1 ? Number(args[portArgIdx + 1]) : 4000;

      const plansIdx = args.indexOf("--plans");
      await startDevServer({
        entry,
        port,
        runtime,
        nativeBridge: bridge,
        plans: command === "dev" ? "compile" : "load",
        plansPath: plansIdx === -1 ? undefined : args[plansIdx + 1],
      });
      break;
    }

    case "build": {
      const entry = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      if (entry) await import(resolve(entry));
      const outIdx = args.indexOf("--output");
      const output = outIdx === -1 ? ".brick/plans.json" : args[outIdx + 1];
      if (!output || output.startsWith("--")) throw new Error("--output requires a file path");
      await compilePlans(getGlobalRegistry().list(), { output, native: runtime === "rust" });
      console.log(`[Brick-TS] Compiled plans written to ${output}`);
      break;
    }

    case "gen": {
      const subCommand = args[1];
      if (subCommand === "openapi") {
        const outIdx = args.indexOf("--output");
        const outputFile = outIdx !== -1 ? args[outIdx + 1] : undefined;

        const spec = generateOpenApiSpec();
        const jsonOutput = JSON.stringify(spec, null, 2);

        if (outputFile) {
          await Bun.write(outputFile, jsonOutput);
          console.log(`✅ OpenAPI 3.1 specification written to ${outputFile}`);
        } else {
          console.log(jsonOutput);
        }
        break;
      }
      console.error(`Unknown generator: ${subCommand}. Available: openapi`);
      process.exit(1);
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
  brick dev [entry] [--port <number>]    Compile plans and start development server
  brick build [entry] [--output <file>]  Compile .brick/plans.json using brickc
  brick start [entry] [--plans <file>]   Start using compiled plans
  --runtime rust                       Use Rust HTTP + in-process TS handlers
  --bridge http                        Use the previous HTTP worker bridge
  brick gen openapi [--output <file>]    Generate OpenAPI 3.1 JSON specification
  brick info                            Export architecture JSON schema
`);
      process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
