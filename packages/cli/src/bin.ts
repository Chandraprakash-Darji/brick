#!/usr/bin/env bun
import { Command, InvalidArgumentError } from "commander";
import { startDevServer, startProdServer } from "./runner";
import { buildApplication } from "./build";
import { writeClientContract } from "./client-contract-file";
import { generateOpenApiSpec } from "@brickkit/core";
import { parsePort } from "./port-utils";
import { loadBrickApp } from "./app-entry";
import cliPkg from "../package.json";

// Single source of truth for the CLI version (inlined at build time).
const CLI_VERSION: string = cliPkg.version;

const PORT_HELP =
  "Port to listen on (CLI --port overrides PORT env, default 4000)";

const PORT_RESOLUTION_HELP = `
Port Resolution (dev/start commands):
  - CLI --port flag takes precedence
  - Falls back to PORT environment variable
  - Defaults to 4000 if neither is set
  - Valid range: 1-65535

Examples:
  brick dev app.ts                        # port 4000 (default)
  brick dev app.ts --port 5000            # port 5000 (explicit)
  PORT=3000 brick dev app.ts              # port 3000 (from env)
  brick dev app.ts --port 6000            # port 6000 (CLI overrides PORT=3000)
`;

function parsePortOption(value: string): number {
  try {
    return parsePort(value, undefined);
  } catch (err) {
    throw new InvalidArgumentError((err as Error).message);
  }
}

function parseFileOption(value: string, usage: string): string {
  if (value.startsWith("-")) {
    throw new InvalidArgumentError(`${usage} (got flag-like value '${value}')`);
  }
  return value;
}

function resolveDevPort(cliPort: number | undefined): number {
  if (cliPort !== undefined) return cliPort;
  return parsePort(undefined, process.env.PORT);
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("brick")
    .description("🧱 Brick-TS CLI")
    .version(CLI_VERSION)
    .showHelpAfterError()
    .addHelpText(
      "after",
      `
Usage:
  brick dev [entry] [--port <number>]                    Start development server with live reload
  brick start [entry] [--port <number>]                  Start production server
  brick build <app.ts> [--outdir <dir>] [--port <number>] [--no-aot]  Compile a default-exported BrickApp into a Bun server
  brick gen openapi <entry> [--output <file>]            Generate OpenAPI 3.1 JSON specification
  brick gen client <entry> [--output <file>]             Generate a typed browser client contract
  brick info <entry>                                     Export architecture JSON schema
${PORT_RESOLUTION_HELP}`,
    );

  program
    .command("dev")
    .description("Start development server with live reload")
    .argument("[entry]", "Application entry file")
    .option("--port <number>", PORT_HELP, parsePortOption)
    .addHelpText("after", PORT_RESOLUTION_HELP)
    .action(async (entry: string | undefined, opts: { port?: number }) => {
      const port = resolveDevPort(opts.port);
      await startDevServer({ entry, port });
    });

  program
    .command("start")
    .description("Start production server")
    .argument("[entry]", "Application entry file")
    .option("--port <number>", PORT_HELP, parsePortOption)
    .addHelpText("after", PORT_RESOLUTION_HELP)
    .action(async (entry: string | undefined, opts: { port?: number }) => {
      const port = resolveDevPort(opts.port);
      await startProdServer({ entry, port });
    });

  program
    .command("build")
    .description("Compile a default-exported BrickApp into a Bun server")
    .argument(
      "<entry>",
      "Application entry file (must default-export a BrickApp)",
    )
    .option("--outdir <dir>", "Output directory", (v: string) =>
      parseFileOption(v, "Usage: brick build <app.ts> [--outdir <directory>]"),
    )
    .option("--port <number>", "Default listening port", parsePortOption)
    .option("--no-aot", "Disable ahead-of-time compilation")
    .option(
      "--prefix <path>",
      "DEPRECATED: configure prefix in brick() app instead",
    )
    .option(
      "--no-request-logging",
      "DEPRECATED: configure requestLogging in brick() app instead",
    )
    .action(
      async (
        entry: string,
        opts: {
          outdir?: string;
          port?: number;
          aot?: boolean;
          prefix?: string;
          requestLogging?: boolean;
        },
      ) => {
        if (opts.prefix !== undefined || opts.requestLogging === false) {
          throw new Error(
            "Brick: configure prefix and requestLogging in your default-exported brick() app instead of build flags.",
          );
        }
        const result = await buildApplication({
          entry,
          outdir: opts.outdir,
          port: opts.port,
          aot: opts.aot,
        });
        for (const warning of result.ir.diagnostics)
          console.warn(`[Brick compiler] ${warning}`);
        console.log(
          `Compiled ${result.ir.services.length} services / ${result.ir.routes.length} routes`,
        );
        console.log(`IR: ${result.outdir}/brick-ir.json`);
        console.log(`Run: bun ${result.entry}`);
      },
    );

  const gen = program
    .command("gen")
    .description("Generate artifacts from a BrickApp entry")
    .argument("[subcommand]", "Generator to run (openapi, client)")
    .action((subcommand: string | undefined) => {
      console.error(
        `Unknown generator: ${subcommand ?? "(none)"}. Available: openapi, client`,
      );
      process.exit(1);
    });

  gen
    .command("openapi")
    .description("Generate OpenAPI 3.1 JSON specification")
    .argument("<entry>", "Application entry file")
    .option(
      "--output <file>",
      "Write specification to file instead of stdout",
      (v: string) =>
        parseFileOption(
          v,
          "Usage: brick gen openapi <entry> [--output <file>]",
        ),
    )
    .action(async (entry: string, opts: { output?: string }) => {
      const app = await loadBrickApp(entry);
      const spec = generateOpenApiSpec({
        services: [...app.definition.services],
        prefix: app.definition.prefix,
      });
      const jsonOutput = JSON.stringify(spec, null, 2);
      if (opts.output) {
        await Bun.write(opts.output, jsonOutput);
        console.log(`✅ OpenAPI 3.1 specification written to ${opts.output}`);
      } else {
        console.log(jsonOutput);
      }
    });

  gen
    .command("client")
    .description("Generate a typed browser client contract")
    .argument("<entry>", "Application entry file")
    .option(
      "--output <file>",
      "Write contract to file (default _brick/contract.ts)",
      (v: string) =>
        parseFileOption(v, "Usage: brick gen client <entry> [--output <file>]"),
    )
    .action(async (entry: string, opts: { output?: string }) => {
      const output = await writeClientContract(entry, opts.output);
      console.log(`Client contract written to ${output}`);
    });

  program
    .command("info")
    .alias("services")
    .description("Export architecture JSON schema")
    .argument("<entry>", "Application entry file")
    .action(async (entry: string) => {
      const app = await loadBrickApp(entry);
      const architecture = {
        version: "1.0.0",
        services: app.definition.services.map((s) => s.introspect()),
      };
      console.log(JSON.stringify(architecture, null, 2));
    });

  return program;
}

async function main() {
  const program = createProgram();
  // Preserve legacy behavior: bare `brick` starts the dev server.
  const userArgs = process.argv.slice(2);
  if (userArgs.length === 0) {
    const port = parsePort(undefined, process.env.PORT);
    await startDevServer({ port });
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  // Commander already prints validation errors (missing arg, unknown option,
  // invalid port) and exits. Only print Fatal error for action failures.
  if (err?.exitCode !== undefined) {
    process.exit(err.exitCode);
  }
  if (err?.code?.startsWith?.("commander.")) {
    process.exit(1);
  }
  console.error("Fatal error:", err);
  process.exit(1);
});
