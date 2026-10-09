#!/usr/bin/env bun
import { startDevServer } from "./runner";
import { buildApplication } from "./build";
import { writeClientContract } from "./client-contract-file";
import { getGlobalRegistry, generateOpenApiSpec } from "@brickkit/core";

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

    case "build": {
      const entry = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      if (!entry)
        throw new Error(
          "Usage: brick build <definitions.ts> [--outdir <directory>] [--prefix <path>] [--port <number>]",
        );
      const value = (flag: string) => {
        const index = args.indexOf(flag);
        if (index === -1) return undefined;
        if (!args[index + 1] || args[index + 1]!.startsWith("--"))
          throw new Error(`Missing value for ${flag}`);
        return args[index + 1];
      };
      const port = value("--port");
      const result = await buildApplication({
        entry,
        outdir: value("--outdir"),
        prefix: value("--prefix"),
        port: port === undefined ? undefined : Number(port),
        requestLogging: !args.includes("--no-request-logging"),
      });
      for (const warning of result.ir.diagnostics)
        console.warn(`[Brick compiler] ${warning}`);
      console.log(
        `Compiled ${result.ir.services.length} services / ${result.ir.routes.length} routes`,
      );
      console.log(`IR: ${result.outdir}/brick-ir.json`);
      console.log(`Run: bun ${result.entry}`);
      break;
    }

    case "gen": {
      const subCommand = args[1];
      if (subCommand === "client") {
        const entry = args[2];
        if (!entry || entry.startsWith("-"))
          throw new Error("Usage: brick gen client <entry> [--output <file>]");
        if (
          args.length > 3 &&
          (args[3] !== "--output" ||
            !args[4] ||
            args[4].startsWith("-") ||
            args.length > 5)
        )
          throw new Error("Usage: brick gen client <entry> [--output <file>]");
        const output = await writeClientContract(entry, args[4]);
        console.log(`Client contract written to ${output}`);
        break;
      }
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
      console.error(
        `Unknown generator: ${subCommand}. Available: openapi, client`,
      );
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
  brick build <entry> [--outdir <dir>]  Compile definitions into a Bun server
  brick gen openapi [--output <file>]    Generate OpenAPI 3.1 JSON specification
  brick gen client <entry> [--output <file>] Generate a typed browser client contract
  brick info                            Export architecture JSON schema
`);
      process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
