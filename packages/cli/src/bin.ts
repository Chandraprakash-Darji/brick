#!/usr/bin/env bun
import { startDevServer } from "./runner";
import { buildApplication } from "./build";
import { writeClientContract } from "./client-contract-file";
import { generateOpenApiSpec } from "@brickkit/core";
import { parsePort } from "./port-utils";
import { loadBrickApp } from "./app-entry";

const args = process.argv.slice(2);
const command = args[0] || "dev";

async function main() {
  switch (command) {
    case "dev":
    case "start": {
      const entry = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      const portArgIdx = args.indexOf("--port");
      const portStr = portArgIdx !== -1 ? args[portArgIdx + 1] : undefined;
      const port = parsePort(portStr, process.env.PORT);

      await startDevServer({ entry, port });
      break;
    }

    case "build": {
      const entry = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      if (!entry)
        throw new Error(
          "Usage: brick build <app.ts> [--outdir <directory>] [--port <number>] [--no-aot]",
        );
      if (args.includes("--prefix") || args.includes("--no-request-logging"))
        throw new Error(
          "Brick: configure prefix and requestLogging in your default-exported brick() app instead of build flags.",
        );
      const value = (flag: string) => {
        const index = args.indexOf(flag);
        if (index === -1) return undefined;
        if (!args[index + 1] || args[index + 1]!.startsWith("--"))
          throw new Error(`Missing value for ${flag}`);
        return args[index + 1];
      };
      const portStr = value("--port");
      let port: number | undefined;
      if (portStr !== undefined) {
        port = parsePort(portStr, undefined);
      }
      const result = await buildApplication({
        entry,
        outdir: value("--outdir"),
        port,
        aot: !args.includes("--no-aot"),
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
        const entry = args[2];
        if (!entry || entry.startsWith("-"))
          throw new Error("Usage: brick gen openapi <entry> [--output <file>]");
        const outIdx = args.indexOf("--output");
        const outputFile = outIdx !== -1 ? args[outIdx + 1] : undefined;

        const app = await loadBrickApp(entry);
        const spec = generateOpenApiSpec({
          services: [...app.definition.services],
          prefix: app.definition.prefix,
        });
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
      const entry = args[1];
      if (!entry || entry.startsWith("-"))
        throw new Error("Usage: brick info <entry>");
      const app = await loadBrickApp(entry);
      const architecture = {
        version: "1.0.0",
        services: app.definition.services.map((s) => s.introspect()),
      };
      console.log(JSON.stringify(architecture, null, 2));
      break;
    }

    default:
      console.log(`
🧱 Brick-TS CLI

Usage:
  brick dev [entry] [--port <number>]                    Start development server with live reload
  brick start [entry] [--port <number>]                  Start production server
  brick build <app.ts> [--outdir <dir>] [--port <number>] [--no-aot]  Compile a default-exported BrickApp into a Bun server
  brick gen openapi <entry> [--output <file>]            Generate OpenAPI 3.1 JSON specification
  brick gen client <entry> [--output <file>]             Generate a typed browser client contract
  brick info <entry>                                     Export architecture JSON schema

Port Resolution (dev/start commands):
  - CLI --port flag takes precedence
  - Falls back to PORT environment variable
  - Defaults to 4000 if neither is set
  - Valid range: 1-65535

Examples:
  brick dev app.ts                        # port 4000 (default)
  brick dev app.ts --port 5000            # port 5000 (explicit)
  PORT=3000 brick dev app.ts              # port 3000 (from env)
  brick dev app.ts --port 6000 PORT=3000  # port 6000 (CLI overrides)
`);
      process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
