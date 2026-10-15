import { expect, test } from "bun:test";

type Step = { uses?: string; run?: string; with?: Record<string, string> };
type Job = {
  needs?: string | string[];
  if?: string;
  strategy?: { "fail-fast": boolean; matrix: { pkg: string[] } };
  steps: Step[];
};
const workflow: { jobs: Record<string, Job> } = Bun.YAML.parse(
  await Bun.file(
    new URL("../.github/workflows/publish-npm.yml", import.meta.url),
  ).text(),
);
const { prepare, validate, commit, publish, release } = workflow.jobs;

test("every package must build, typecheck, test, and pack before release side effects", () => {
  expect(validate!.strategy?.matrix.pkg).toEqual(["core", "crud", "cli"]);
  expect(validate!.strategy?.["fail-fast"]).toBe(false);
  const commands = validate!.steps.map((step) => step.run ?? "").join("\n");
  expect(commands).toContain("bun run build");
  expect(commands).toContain(
    "bun run --filter @brickkit/${{ matrix.pkg }} typecheck",
  );
  expect(commands).toContain("bun test packages/${{ matrix.pkg }}");
  expect(commands).toContain("npm pack --ignore-scripts");
  expect(commit!.needs).toContain("validate");
  expect(publish!.needs).toContain("validate");
  expect(publish!.needs).toContain("commit");
  expect(commit!.if).not.toContain("always()");
  expect(publish!.if).not.toContain("always()");
  expect(release!.needs).toContain("publish");
});

test("candidate preparation cannot commit or publish, and dry runs stop after validation", () => {
  const commands = prepare!.steps.map((step) => step.run ?? "").join("\n");
  expect(commands).toContain('bun run release "$RELEASE_BUMP" --prepare');
  expect(commands).not.toMatch(/git (commit|tag|push)|npm publish/);
  expect(commit!.if).toContain("inputs.dry_run != true");
  expect(publish!.if).toContain("inputs.dry_run != true");
  expect(commit!.if).toContain("github.event_name != 'pull_request'");
  expect(publish!.if).toContain("github.event_name != 'pull_request'");
  expect(
    prepare!.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
      ?.with?.ref,
  ).toBe("${{ github.sha }}");
});

test("publishing uses the exact checked tarballs without rerunning tests or builds", () => {
  const upload = validate!.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  const download = publish!.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  expect(upload?.with?.name).toBe("package-${{ matrix.pkg }}");
  expect(download?.with?.name).toBe(upload?.with?.name);
  const commands = publish!.steps.map((step) => step.run ?? "").join("\n");
  expect(commands).toContain('npm publish "$RUNNER_TEMP/package/"*.tgz');
  expect(commands).not.toMatch(/bun (test|run build|install)/);
  expect(publish!.strategy?.matrix.pkg).toEqual(["core", "crud", "cli"]);
});
