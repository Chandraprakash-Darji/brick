import { beforeEach, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineService, resetGlobalRegistry, t } from "@brickkit/core";
import { createBrickClient } from "@brickkit/core/client";
import { generateClientContract } from "../src/client-contract";
import { brick } from "../src/server";

beforeEach(resetGlobalRegistry);

it("generates a typed browser contract from two services without an action list", async () => {
  const root = resolve(import.meta.dir, "../../..");
  await mkdir(join(root, ".brick"), { recursive: true });
  const dir = await mkdtemp(join(root, ".brick/client-test-"));
  try {
    const output = join(dir, "contract.ts");
    const app = (await import("./fixtures/client-app")).default;
    await Bun.write(output, generateClientContract(app));
    const { contract } = await import(output);
    expect(Object.keys(contract)).toEqual(["records", "users"]);
    expect(Object.keys(contract.records)).toEqual(["get_value", "search"]);
    expect(Object.keys(contract.users)).toEqual(["profile", "update"]);
    expect(contract.records.get_value.config).toEqual({
      path: "/v2/records/:doctype/value",
      method: "POST",
    });
    expect(contract.records.search.config.path).toBe("/v2/records/search");
    expect(JSON.stringify(contract)).not.toContain("execute");

    const bundle = await Bun.build({
      entrypoints: [output],
      target: "browser",
    });
    expect(bundle.success).toBe(true);
    const browserSource = await bundle.outputs[0]!.text();
    expect(browserSource).not.toContain("__backend_only__");
    expect(browserSource).not.toContain("defineService");
    expect(browserSource).not.toContain("bun:sqlite");

    await Bun.write(
      join(dir, "types.ts"),
      `
import { createBrickClient, type InferActionErrorCodes } from "@brickkit/core/client";
import { contract, type AppContract } from "./contract";
const api = createBrickClient<AppContract>({ baseUrl: "http://localhost", contract });
const inferred = createBrickClient({ baseUrl: "http://localhost", contract });
const inferredValue: Promise<string> = inferred.records.get_value({ doctype: "CRMDeal", fields: [] });
// @ts-expect-error Inference preserves input types without an explicit generic.
inferred.records.get_value({ doctype: "Other", fields: [] });
const value: Promise<string> = api.records.get_value({ doctype: "CRMDeal", fields: ["name"] });
const search: Promise<string[]> = api.records.search({ term: "hello" });
const profile: Promise<{ id: string; roles: ("admin" | "member")[] }> = api.users.profile.get({ id: "u1" });
const update: Promise<boolean> = api.users.update({ id: "u1", name: "Sam" });
const code: InferActionErrorCodes<AppContract["records"]["get_value"]> = "MISSING";
// @ts-expect-error Missing fields.
api.records.get_value({ doctype: "CRMDeal" });
// @ts-expect-error Invalid doctype literal.
api.records.get_value({ doctype: "Other", fields: [] });
// @ts-expect-error Wrong input type.
api.records.search({ term: 42 });
// @ts-expect-error Non-HTTP tools are absent.
api.records.private_tool();
// @ts-expect-error Unknown action.
api.users.missing();
`,
    );
    await Bun.write(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: join(root, "tsconfig.json"),
        compilerOptions: { noEmit: true },
        include: ["*.ts"],
      }),
    );
    const typecheck = Bun.spawn(
      [
        Bun.which("bun")!,
        "x",
        "--no-install",
        "tsc",
        "-p",
        join(dir, "tsconfig.json"),
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [typeCode, typeOut, typeErr] = await Promise.all([
      typecheck.exited,
      new Response(typecheck.stdout).text(),
      new Response(typecheck.stderr).text(),
    ]);
    expect(typeOut + typeErr).toBe("");
    expect(typeCode).toBe(0);

    const calls: { url: string; init?: RequestInit }[] = [];
    const api = createBrickClient<any>({
      baseUrl: "http://localhost",
      contract,
      fetch: (url, init) => {
        calls.push({ url: String(url), init });
        return app.handle(new Request(url, init));
      },
    });
    expect(
      await api.records.get_value({ doctype: "CRMDeal", fields: ["name"] }),
    ).toBe("CRMDeal:name");
    expect(calls[0]!.url).toBe("http://localhost/v2/records/CRMDeal/value");
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      fields: ["name"],
    });
    expect(await api.records.search({ term: "hello" })).toEqual(["hello"]);
    expect(await api.users.profile.get({ id: "a b", details: true })).toEqual({
      id: "a b",
      roles: ["member"],
    });
    expect(calls[2]!.url).toBe("http://localhost/v2/users/a%20b?details=true");
    expect(await api.users.update({ id: "u1", name: "Sam" })).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

it("rejects ambiguous namespaces and unsupported schemas instead of silently weakening types", () => {
  const service = defineService("records");
  service.action({ name: "lookup", execute: () => "ok" });
  service.action({ name: "lookup.detail", execute: () => "ok" });
  expect(() =>
    generateClientContract(
      brick({ services: [service], requestLogging: false }),
    ),
  ).toThrow("namespace collision");
  const unsupported = defineService("unsupported");
  const action = unsupported.action({
    name: "ref",
    input: t.String(),
    execute: () => "ok",
  });
  const app = brick({ services: [unsupported], requestLogging: false });
  action.config.input = t.Ref("Missing") as any;
  expect(() => generateClientContract(app)).toThrow(
    "unresolved schema reference 'Missing'",
  );
});

it("resolves recursive TypeBox schemas and local references without weakening client types", async () => {
  const json = t.Recursive(
    (self) =>
      t.Union([
        t.Null(),
        t.Boolean(),
        t.Number(),
        t.String(),
        t.Array(self),
        t.Record(t.String(), self),
      ]),
    { $id: "T0", title: "JsonValue" },
  );
  const service = defineService("crm");
  service.action({
    name: "crm_get_fields_layout",
    input: t.Object({ filters: json }),
    output: t.Object({
      tabs: t.Array(
        t.Object({
          sections: t.Array(
            t.Object({
              columns: t.Array(
                t.Object({
                  fields: t.Array(t.Object({ link_filters: json })),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
    execute: () => ({ tabs: [] }),
  });
  service.action({
    name: "tree",
    // Reusing an ID in a different document must not resolve to the JSON union.
    output: t.Recursive(
      (self) => t.Object({ value: t.Number(), children: t.Array(self) }),
      { $id: "T0" },
    ),
    execute: () => ({ value: 1, children: [] }),
  });
  const local = service.action({
    name: "local",
    output: t.String(),
    execute: () => "ok",
  });
  const app = brick({ services: [service], requestLogging: false });
  // Forward references, mutual recursion, and escaped JSON Pointer segments.
  local.config.output = {
    $ref: "#/$defs/a~1b~0c",
    $defs: {
      "a/b~c": {
        type: "object",
        properties: { next: { $ref: "#/$defs/other" } },
      },
      other: {
        type: "object",
        properties: {
          value: { type: "string" },
          next: { $ref: "#/$defs/a~1b~0c" },
        },
        required: ["value"],
      },
    },
  } as any;
  const source = generateClientContract(app);
  expect(source).toContain("export type BrickJsonValue =");
  expect(source).toContain("Array<BrickJsonValue>");
  expect(source).toContain("{ [key: string]: BrickJsonValue }");
  expect(source).toContain("export type BrickT0 =");
  expect(source.split("export type AppContract")[0]).not.toContain("unknown");

  const root = resolve(import.meta.dir, "../../..");
  await mkdir(join(root, ".brick"), { recursive: true });
  const dir = await mkdtemp(join(root, ".brick/recursive-client-test-"));
  try {
    await Bun.write(join(dir, "contract.ts"), source);
    await Bun.write(
      join(dir, "types.ts"),
      `
import { createBrickClient } from "@brickkit/core/client";
import { contract } from "./contract";
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const api = createBrickClient({ baseUrl: "http://localhost", contract });
api.crm.crm_get_fields_layout({ filters: { nested: [null, true, 1, "hello", { deeper: [] }] } });
// @ts-expect-error Functions are not JSON values, even deep inside a recursive branch.
api.crm.crm_get_fields_layout({ filters: { nested: [{ invalid: () => 1 }] } });
// @ts-expect-error Undefined is not a JSON value.
api.crm.crm_get_fields_layout({ filters: { nested: undefined } });
async function check() {
  const layout = await api.crm.crm_get_fields_layout({ filters: null });
  const filters: JsonValue = layout.tabs[0]!.sections[0]!.columns[0]!.fields[0]!.link_filters;
  // @ts-expect-error The generated union must not be any.
  const invalid: string = filters;
  const tree = await api.crm.tree();
  const value: number = tree.children[0]!.children[0]!.value;
  // @ts-expect-error Recursive tree values remain numbers.
  const wrong: string = tree.children[0]!.value;
  const local = await api.crm.local();
  const text: string | undefined = local.next?.next?.next?.value;
}
`,
    );
    await Bun.write(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: join(root, "tsconfig.json"),
        compilerOptions: { noEmit: true },
        include: ["*.ts"],
      }),
    );
    const proc = Bun.spawn(
      [
        Bun.which("bun")!,
        "x",
        "--no-install",
        "tsc",
        "-p",
        join(dir, "tsconfig.json"),
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(out + err).toBe("");
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

it("reports missing local reference targets with the action name", () => {
  const service = defineService("refs");
  const action = service.action({
    name: "missing",
    output: t.String(),
    execute: () => "ok",
  });
  const app = brick({ services: [service], requestLogging: false });
  action.config.output = { $ref: "#/$defs/Missing", $defs: {} } as any;
  expect(() => generateClientContract(app)).toThrow(
    "Brick client: cannot generate 'refs.missing': unresolved schema reference '#/$defs/Missing'",
  );
});
