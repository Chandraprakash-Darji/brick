import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Builds the Workflow inspector (../workflow-inspector, which needs a toolchain
// of its own) and copies its build into inspector-dist/, which the package
// ships and `brick dev` serves. The inspector is Apache-2.0 work derived from
// @workflow/web, so its license and notice travel with it.
const source = fileURLToPath(
  new URL("../../workflow-inspector/", import.meta.url),
);
const target = fileURLToPath(new URL("../inspector-dist/", import.meta.url));

const build = Bun.spawn(["bun", "run", "build"], {
  cwd: source,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await build.exited) !== 0)
  throw new Error("The inspector failed to build.");

await rm(target, { recursive: true, force: true });
await cp(`${source}build`, target, { recursive: true });
for (const file of ["LICENSE.md", "NOTICE"])
  await cp(`${source}${file}`, `${target}${file}`);
console.log("Inspector built into inspector-dist/");
