#!/usr/bin/env bun
import { Command, InvalidArgumentError } from "commander";
import { startDevServer, startProdServer } from "./runner";
import { buildApplication } from "./build";
import { writeClientContract } from "./client-contract-file";
import { parsePort } from "./port-utils";
import { loadApplication } from "./app-entry";
import cliPkg from "../package.json";

const PORT_HELP =
  "Port to listen on (CLI --port overrides PORT env, default 4000)";
const PORT_RESOLUTION_HELP = `
Port Resolution (dev/start commands):
  - CLI --port flag takes precedence
  - Falls back to PORT environment variable
  - Defaults to 4000 if neither is set
  - Valid range: 1-65535

Examples:
  brick dev app.ts --port 5000
  PORT=3000 brick start app.ts
`;
function parsePortOption(value: string): number {
  try {
    return parsePort(value, undefined);
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}
function parseFileOption(value: string, usage: string): string {
  if (value.startsWith("-"))
    throw new InvalidArgumentError(`${usage} (got flag-like value '${value}')`);
  return value;
}
export function createProgram(): Command {
  const program = new Command()
    .name("brick")
    .description("Brick Effect application tooling")
    .version(cliPkg.version)
    .showHelpAfterError()
    .addHelpText("after", PORT_RESOLUTION_HELP);
  for (const command of ["dev", "start"] as const) {
    program
      .command(command)
      .description(
        command === "dev"
          ? "Start development server with live reload"
          : "Start production server",
      )
      .argument("<entry>", "Application entry file")
      .option("--port <number>", PORT_HELP, parsePortOption)
      .addHelpText("after", PORT_RESOLUTION_HELP)
      .action(async (entry: string, opts: { port?: number }) => {
        const port = parsePort(
          opts.port === undefined ? undefined : String(opts.port),
          process.env.PORT,
        );
        await (command === "dev" ? startDevServer : startProdServer)({
          entry,
          port,
        });
      });
  }
  program
    .command("build")
    .description("Bundle an Effect application into a Bun server")
    .argument("<entry>", "Application entry file")
    .option("--outdir <dir>", "Output directory", (value) =>
      parseFileOption(
        value,
        "Usage: brick build <app.ts> [--outdir <directory>]",
      ),
    )
    .option("--port <number>", "Default listening port", parsePortOption)
    .action(async (entry: string, opts: { outdir?: string; port?: number }) => {
      const result = await buildApplication({ entry, ...opts });
      console.log(
        `Compiled ${result.ir.services.length} services / ${result.ir.routes.length} routes`,
      );
      console.log(`IR: ${result.outdir}/brick-ir.json`);
      console.log(`Run: bun ${result.entry}`);
    });
  const gen = program
    .command("gen")
    .description("Generate artifacts from an application entry")
    .argument("[subcommand]", "Generator to run (openapi, client)")
    .action((subcommand: string | undefined) => {
      throw new Error(
        `Unknown generator: ${subcommand ?? "(none)"}. Available: openapi, client`,
      );
    });
  gen
    .command("openapi")
    .description("Generate OpenAPI 3.1 JSON specification")
    .argument("<entry>", "Application entry file")
    .option(
      "--output <file>",
      "Write specification to file instead of stdout",
      (value) =>
        parseFileOption(
          value,
          "Usage: brick gen openapi <entry> [--output <file>]",
        ),
    )
    .action(async (entry: string, opts: { output?: string }) => {
      const app = await loadApplication(entry);
      try {
        const json = JSON.stringify(app.openApi(), null, 2);
        if (opts.output) {
          await Bun.write(opts.output, json);
          console.log(`OpenAPI 3.1 specification written to ${opts.output}`);
        } else console.log(json);
      } finally {
        await app.dispose();
      }
    });
  gen
    .command("client")
    .description("Generate a typed browser client contract")
    .argument("<entry>", "Application entry file")
    .option(
      "--output <file>",
      "Write contract to file (default _brick/contract.ts)",
      (value) =>
        parseFileOption(
          value,
          "Usage: brick gen client <entry> [--output <file>]",
        ),
    )
    .action(async (entry: string, opts: { output?: string }) => {
      console.log(
        `Client contract written to ${await writeClientContract(entry, opts.output)}`,
      );
    });
  program
    .command("info")
    .alias("services")
    .description("Export architecture JSON schema")
    .argument("<entry>", "Application entry file")
    .action(async (entry: string) => {
      const app = await loadApplication(entry);
      try {
        console.log(
          JSON.stringify(
            {
              version: 2,
              target: "effect-http-api",
              services: app.services.map((service) => ({
                name: service.name,
                actions: Object.values(service.actions).map((action) => ({
                  name: action.endpoint.identifier,
                  method: action.method,
                  path: action.path,
                })),
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        await app.dispose();
      }
    });
  return program;
}
async function main() {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}
await main();
