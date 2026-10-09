#!/usr/bin/env bun
/** Large filter contract: raw source size, generation time, and TypeScript check time. */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { defineService, resetGlobalRegistry, t } from "../packages/core/src";
import { brick } from "../packages/cli/src/server";
import { generateClientContract } from "../packages/cli/src/client-contract";
import { argInt, argStr, median, parseArgs } from "./lib/stats";

const args = parseArgs(process.argv.slice(2));
const actions = argInt(args, "actions", 40);
const fields = argInt(args, "fields", 100);
const rounds = argInt(args, "rounds", 5);
if (![actions, fields, rounds].every((n) => Number.isInteger(n) && n > 0))
  throw new Error("actions, fields, and rounds must be positive integers");
const generatorPath = argStr(args, "generator", "");
const generate: typeof generateClientContract = generatorPath
  ? (await import(resolve(generatorPath))).generateClientContract
  : generateClientContract;
resetGlobalRegistry();
const service = defineService("contract_bench");
const operator = t.Union(
  [
    "=",
    "!=",
    ">",
    ">=",
    "<",
    "<=",
    "like",
    "not like",
    "in",
    "not in",
    "is",
    "between",
  ].map((value) => t.Literal(value)),
);
const conditions = [false, true].map((bounded) => {
  const scalar = t.Union([
    t.String(bounded ? { maxLength: 140 } : {}),
    t.Null(),
  ]);
  return t.Union([
    scalar,
    t.Tuple([
      operator,
      t.Union([
        scalar,
        t.Array(scalar),
        t.Literal("set"),
        t.Literal("not set"),
      ]),
    ]),
  ]);
});
for (let i = 0; i < actions; i++) {
  service.action({
    name: `query${i}`,
    input: t.Object({
      doctype: t.Literal(`DocType${i}`),
      ...Object.fromEntries(
        Array.from({ length: fields }, (_, j) => [
          `field${j}`,
          t.Optional(conditions[j % conditions.length]!),
        ]),
      ),
    }),
    output: t.Array(t.String()),
    execute: () => [],
  });
}
const app = brick({ services: [service], requestLogging: false });
generate(app); // Warm the generator before recording samples.
const times: number[] = [];
let source = "";
for (let i = 0; i < rounds; i++) {
  const start = performance.now();
  source = generate(app);
  times.push(performance.now() - start);
}
const root = resolve(import.meta.dir, "..");
await mkdir(join(root, ".brick"), { recursive: true });
const dir = await mkdtemp(join(root, ".brick/contract-bench-"));
try {
  await Bun.write(join(dir, "contract.ts"), source);
  await Bun.write(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      extends: join(root, "tsconfig.json"),
      compilerOptions: { noEmit: true },
      include: ["contract.ts"],
    }),
  );
  const checks: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const start = performance.now();
    const proc = Bun.spawn(
      [
        Bun.which("bun")!,
        "x",
        "--no-install",
        "tsc",
        "-p",
        join(dir, "tsconfig.json"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(out + err);
    checks.push(performance.now() - start);
  }
  console.log(
    JSON.stringify(
      {
        actions,
        fields,
        rounds,
        raw_bytes: Buffer.byteLength(source),
        aliases: (source.match(/export type /g)?.length ?? 1) - 1,
        generation_median_ms: median(times),
        typecheck_median_ms: median(checks),
        generation_samples_ms: times,
        typecheck_samples_ms: checks,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
