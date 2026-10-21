// Loads files with the workflow transform installed and prints what it got. It
// runs in a process of its own: the transform installs once per process.
import { join } from "node:path";
import { registerWorkflowTransform } from "../../../src/workflows";

const installed = await registerWorkflowTransform(
  join(import.meta.dir, "..", "workflow-app"),
);
const { hello } = await import("../workflow-app/src/hello");
console.log(
  JSON.stringify({
    installed,
    ts: require("./plain.ts"),
    cts: require("./plain.cts"),
    jsx: (await import("./view.js")).view,
    step: (await import("./card")).card,
    workflowId: (hello as { workflowId?: string }).workflowId,
  }),
);
