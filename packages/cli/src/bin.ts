#!/usr/bin/env bun
import { startDevServer } from "./runner";
import { getGlobalRegistry, generateOpenApiSpec } from "@brick/core";

const args = process.argv.slice(2);
const command = args[0] || "dev";

async function main() {
  switch (command) {
    case "dev":
    case "start": {
      const entry = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      const portArgIdx = args.indexOf("--port");
      const port = portArgIdx !== -1 ? Number(args[portArgIdx + 1]) : 4000;

      await startDevServer({ entry, port });
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
  brick dev [entry] [--port <number>]    Start development server with live reload
  brick start [entry]                   Start production server
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
