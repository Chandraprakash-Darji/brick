import { beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineService, resetGlobalRegistry, t } from "@brickkit/core";
import {
  compileBrickApplication,
  emitCompiledApplication,
} from "../src/compiler";
import { brick } from "../src/server";

beforeEach(resetGlobalRegistry);
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      "x-trace-id": "trace-test",
      "x-request-id": "request-test",
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

it("emits a frozen IR and a synchronous handler with no input/context/auth stages", () => {
  const service = defineService("simple");
  service.action({
    name: "getReady",
    execute: ({ ctx }) => ({ ok: true, request: ctx.requestId }),
  });
  const compilation = compileBrickApplication({ services: [service] });
  expect(Object.isFrozen(compilation)).toBe(true);
  expect(Object.isFrozen(compilation.ir.routes[0]!.inputPrecedence)).toBe(true);
  const route = compilation.routes.find((r) => r.ir.method === "GET")!;
  const source = route.handler.toString();
  expect(source).not.toContain("params");
  expect(source).not.toContain("contextHook(");
  expect(source).not.toContain("authorize(");
  const value = route.handler({
    request: request("/api/simple/getReady"),
    headers: { "x-request-id": "custom" },
    set: { headers: {} },
  });
  expect(value).not.toBeInstanceOf(Promise);
  expect(value).toEqual({ ok: true, request: "custom" });
});

it("matches generic route behavior for input precedence, coercion, schema errors and async authorization", async () => {
  const order: string[] = [];
  const service = defineService("secure", {
    context: async (ctx) => {
      order.push("context");
      return {
        user: ctx.request.headers.get("x-user") ? { id: "alice" } : null,
      };
    },
  });
  service.action({
    name: "getValue",
    path: "/custom/:id",
    input: t.Object({
      id: t.String(),
      count: t.Number(),
      enabled: t.Boolean(),
    }),
    output: t.Object({
      id: t.String(),
      count: t.Number(),
      enabled: t.Boolean(),
    }),
    authorize: async ({ user }) => {
      order.push("authorize");
      return Boolean(user);
    },
    execute: async ({ input }) => {
      order.push("execute");
      return input;
    },
  });
  service.action({
    name: "badOutput",
    output: t.Number(),
    execute: async () => "bad" as any,
  });
  service.action({
    name: "knownError",
    execute: ({ error }) => error.NOT_FOUND("missing"),
  });
  service.action({
    name: "broken",
    execute: () => {
      throw new Error("broken");
    },
  });
  const compiled = brick({ services: [service], requestLogging: false });
  const generic = brick({
    services: [service],
    requestLogging: false,
    compiler: false,
  });
  const cases: [string, string, unknown?, Record<string, string>?][] = [
    [
      "/custom/path?count=2&enabled=1&id=query",
      "GET",
      undefined,
      { "x-user": "alice" },
    ],
    [
      "/custom/path?count=0x10&enabled=false",
      "GET",
      undefined,
      { "x-user": "alice" },
    ],
    [
      "/custom/path?count=4&enabled=1&id=query",
      "POST",
      { id: "body", count: 3, enabled: false },
      { "x-user": "alice" },
    ],
    [
      "/custom/path?count=bad&enabled=1",
      "GET",
      undefined,
      { "x-user": "alice" },
    ],
    ["/custom/path?count=2&enabled=1", "GET"],
    ["/api/secure/getValue", "POST", {}],
    ["/api/secure/badOutput", "POST"],
    ["/api/secure/knownError", "POST"],
    ["/api/secure/broken", "POST"],
  ];
  for (const [path, method, body, headers] of cases) {
    order.length = 0;
    const a = await compiled.handle(request(path, method, body, headers));
    const compiledOrder = [...order];
    order.length = 0;
    const b = await generic.handle(request(path, method, body, headers));
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
    expect(order).toEqual(compiledOrder);
    expect(a.headers.get("x-trace-id")).toBe("trace-test");
  }
});

it("isolates request contexts and maps Promise/thenable rejections", async () => {
  const service = defineService("async", {
    context: (ctx) => ({ userId: ctx.request.headers.get("x-user") }),
  });
  service.action({
    name: "getUser",
    execute: async ({ ctx }) => {
      await Bun.sleep(1);
      return { user: ctx.userId };
    },
  });
  const plain = defineService("plain");
  plain.action({
    name: "getThenable",
    output: t.Object({ ok: t.Boolean() }),
    execute: () =>
      ({
        // oxlint-disable-next-line unicorn/no-thenable -- Tests promise assimilation for custom thenables.
        then: (resolve: Function) => resolve({ ok: true }),
      }) as any,
  });
  plain.action({
    name: "getRejected",
    execute: () => Promise.reject(new Error("rejected")),
  });
  const app = brick({ services: [service, plain], requestLogging: false });
  const users = await Promise.all(
    Array.from({ length: 16 }, async (_, i) => {
      const response = await app.handle(
        request("/api/async/getUser", "GET", undefined, {
          "x-user": String(i),
        }),
      );
      return response.json();
    }),
  );
  expect(users.map((u) => u.user)).toEqual(
    Array.from({ length: 16 }, (_, i) => String(i)),
  );
  expect(
    await (await app.handle(request("/api/plain/getThenable"))).json(),
  ).toEqual({ ok: true });
  const failure = await app.handle(request("/api/plain/getRejected"));
  expect(failure.status).toBe(500);
  expect((await failure.json()).message).toBe("rejected");
});

it("loads emitted handler functions and rejects stale schemas rather than using old validation", async () => {
  const service = defineService("emitted");
  const action = service.action({
    name: "getItem",
    input: t.Object({ id: t.String() }),
    execute: ({ input }) => input,
  });
  const compilation = compileBrickApplication({
    services: [service],
    prefix: "/v1",
  });
  const dir = await mkdtemp(join(tmpdir(), "brick-compiler-"));
  try {
    const path = join(dir, "routes.mjs");
    // Use the source module for this repository test; published artifacts use the package subpath.
    await Bun.write(
      path,
      emitCompiledApplication(
        compilation.ir,
        new URL("../src/compiler.ts", import.meta.url).href,
      ),
    );
    const emitted = await import(path);
    const rebound = emitted.bind([service]);
    const app = brick({
      services: [service],
      compilation: rebound,
      requestLogging: false,
    });
    expect(
      await (await app.handle(request("/v1/emitted/getItem?id=abc"))).json(),
    ).toEqual({
      id: "abc",
    });
    action.config.input = t.Object({ id: t.Number() }) as any;
    expect(() => emitted.bind([service])).toThrow(
      "differ from the compiled IR",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("reports route collisions and safely quotes names/keys in generated code", async () => {
  const service = defineService("quoted");
  service.action({
    name: "get'Quote",
    path: "/shared",
    input: t.Object({ "odd'key": t.Number() }),
    execute: ({ input }) => input,
  });
  service.action({ name: "getOther", path: "/shared", execute: () => "other" });
  const compilation = compileBrickApplication({ services: [service] });
  expect(compilation.ir.diagnostics.length).toBe(2);
  const route = compilation.routes.find(
    (route) => route.ir.path === "/shared" && route.ir.method === "GET",
  )!;
  const value = await route.handler({
    query: { "odd'key": "2" },
    params: {},
    headers: {},
    request: request("/shared?odd%27key=2"),
    set: { headers: {} },
  });
  expect(value).toEqual({ "odd'key": 2 });
});
