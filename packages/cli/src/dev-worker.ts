import { getGlobalRegistry } from "@brickkit/core";
import { startDevApplication } from "./runner";
import { parsePort } from "./port-utils";
import {
  installWorkerTelemetry,
  reportWorkerError,
  sendToSupervisor,
} from "./dev-telemetry";
import type { WorkerErrorPhase } from "./dev-telemetry";

// argv[6] is "1" when the supervisor serves the dashboard and needs spans.
const telemetry = process.argv[6] === "1";
let startupComplete = false;
let reported = false;

async function reportOnce(phase: WorkerErrorPhase, error: unknown) {
  if (!telemetry || reported) return;
  reported = true;
  await reportWorkerError(phase, error);
}

async function exitAfterFailure(phase: WorkerErrorPhase, error: unknown) {
  await reportOnce(phase, error);
  console.error(error);
  process.exit(1);
}

if (telemetry) {
  installWorkerTelemetry();
  // Failures before the app is listening are startup failures, not crashes.
  const phaseOf = (): WorkerErrorPhase =>
    startupComplete ? "uncaught" : "startup";
  process.on("uncaughtException", (error) => {
    void exitAfterFailure(phaseOf(), error);
  });
  process.on("unhandledRejection", (reason) => {
    void exitAfterFailure(
      startupComplete ? "unhandled-rejection" : "startup",
      reason,
    );
  });
}

// Scan local imports so dependencies outside the app directory are watched too.
if (process.argv[2]) {
  const files = new Set<string>();
  try {
    await Bun.build({
      entrypoints: [process.argv[2]],
      target: "bun",
      packages: "external",
      plugins: [
        {
          name: "brick:dependencies",
          setup(build) {
            build.onLoad({ filter: /./ }, (args) => {
              files.add(args.path);
              return undefined;
            });
          },
        },
      ],
    });
  } finally {
    process.send?.({ type: "brick:dependencies", files: [...files] });
  }
}

try {
  const app = await startDevApplication({
    entry: process.argv[2],
    port: parsePort(process.argv[3] || undefined, process.env.PORT),
    prefix: process.argv[4] || undefined,
    clientOutput: process.argv[5] || undefined,
  });
  startupComplete = true;
  if (telemetry) {
    void sendToSupervisor({
      type: "brick:architecture",
      architecture: getGlobalRegistry().exportArchitecture(app.definition),
    });
    void sendToSupervisor({
      type: "brick:documentation",
      documentation: app.definition.documentation,
    });
    void app.referenceDocuments().then(
      (documents) =>
        sendToSupervisor({ type: "brick:api-documents", documents }),
      (error: unknown) =>
        console.warn(
          `[Brick-TS] Could not load the API documents: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  }
  if (telemetry && !app.definition.telemetry) {
    console.warn(
      "[Brick-TS] The dashboard shows no requests: pass { telemetry: true } to brick() in your app entry.",
    );
  }
} catch (error) {
  await reportOnce("startup", error);
  throw error;
}
