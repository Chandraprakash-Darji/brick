import { expect, test } from "bun:test";
import { Context, Effect, Layer, Schema, SchemaGetter } from "effect";
import { HttpApiClient, HttpApiTest } from "effect/http-api";
import { HttpServer, HttpServerRequest } from "effect/http";
import { RpcGroup } from "effect/rpc";
import { Toolkit } from "effect/ai";
import { Brick, NotFound, Conflict } from "../src/native";

class Repo extends Context.Service<Repo, { prefix: string }>()(
  "native-test/Repo",
) {}
class Codec extends Context.Service<Codec, { suffix: string }>()(
  "native-test/Codec",
) {}
const define = Brick.action("lookup", "/lookup", {
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.String,
  errors: [Brick.errors.NotFound, Brick.errors.Conflict],
  expose: "both",
});
const lookup = define((input) =>
  Effect.gen(function* () {
    const repo = yield* Repo;
    if (input.id === "missing")
      return yield* new Brick.errors.NotFound({ message: input.id });
    if (input.id === "conflict")
      return yield* new Brick.errors.Conflict({ message: input.id });
    return repo.prefix + input.id;
  }),
);
const rpcLayer = RpcGroup.make(lookup.rpc).toLayer({ lookup: lookup.handler });
const toolLayer = Toolkit.make(lookup.tool).toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<Repo>();
    return {
      lookup: (input: { readonly id: string }) =>
        lookup.handler(input).pipe(Effect.provideContext(context)),
    };
  }),
);
const pages = Brick.service("pages", { actions: { lookup } });
const admin = Brick.service("admin", {
  actions: {
    flag: Brick.action("flag", "/flag", {
      input: Schema.Struct({ enabled: Schema.Boolean }),
      output: Schema.Boolean,
      errors: [],
    })((input) => Effect.succeed(input.enabled)),
  },
});
const post = (
  app: { fetch: (r: Request) => Promise<Response> },
  path: string,
  body: unknown,
) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const equal = <_T extends true>() => {};
equal<Equal<Layer.Services<typeof rpcLayer>, Repo>>();
equal<Equal<Layer.Services<typeof toolLayer>, Repo>>();
equal<Equal<Effect.Services<ReturnType<typeof lookup.handler>>, Repo>>();
equal<
  Equal<Effect.Error<ReturnType<typeof lookup.handler>>, NotFound | Conflict>
>();
class Undeclared extends Schema.TaggedError<Undeclared>()("Undeclared", {}) {}
// @ts-expect-error undeclared failure
const badError = define(() => Effect.fail(new Undeclared()));
// @ts-expect-error invalid output
const badOutput = define(() => Effect.succeed(42));
void badError;
void badOutput;
function negatives() {
  // @ts-expect-error missing static repository
  Brick.app({ services: [pages], layer: Layer.empty });
}
void negatives;

test("native apps own their layers and preserve grouped contracts and errors", async () => {
  const events: string[] = [];
  const live = (prefix: string) =>
    Layer.effect(
      Repo,
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push(`acquire:${prefix}`);
          return { prefix };
        }),
        () =>
          Effect.sync(() => {
            events.push(`release:${prefix}`);
          }),
      ),
    );
  const a = Brick.app({
    services: [pages, admin],
    layer: live("a:"),
    docs: { path: "/docs" },
  });
  const b = Brick.app({ services: [pages, admin], layer: live("b:") });
  type Client = HttpApiClient.ForApi<typeof a.api>;
  function clientTypes(client: Client) {
    // @ts-expect-error wrong input
    client.pages.lookup({ payload: { id: 4 } });
    // @ts-expect-error exact group identifiers
    client.unknown.lookup({ payload: { id: "a" } });
  }
  void clientTypes;
  try {
    expect(await (await post(a, "/lookup", { id: "x" })).json()).toBe("a:x");
    expect(await (await post(b, "/lookup", { id: "x" })).json()).toBe("b:x");
    expect(await (await post(a, "/flag", { enabled: true })).json()).toBe(true);
    expect((await post(a, "/lookup", { id: 2 })).status).toBe(400);
    expect((await post(a, "/flag", { id: "x" })).status).toBe(400);
    expect((await post(a, "/lookup", { id: "missing" })).status).toBe(404);
    expect((await post(a, "/lookup", { id: "conflict" })).status).toBe(409);
    expect((await a.fetch(new Request("http://localhost/docs"))).status).toBe(
      200,
    );
    expect(a.openApi().paths["/lookup"]).toBeDefined();
    await a.dispose();
    expect(events).toEqual(["acquire:a:", "acquire:b:", "release:a:"]);
    expect(await (await post(b, "/lookup", { id: "y" })).json()).toBe("b:y");
  } finally {
    await a.dispose();
    await b.dispose();
  }
  expect(events).toEqual([
    "acquire:a:",
    "acquire:b:",
    "release:a:",
    "release:b:",
  ]);
  const compiled = Brick.compileService(pages);
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(compiled.api, ["pages"]);
      const missing = yield* client.pages
        .lookup({ payload: { id: "missing" } })
        .pipe(Effect.flip);
      expect(missing).toBeInstanceOf(Brick.errors.NotFound);
      const conflict = yield* client.pages
        .lookup({ payload: { id: "conflict" } })
        .pipe(Effect.flip);
      expect(conflict).toBeInstanceOf(Brick.errors.Conflict);
    }).pipe(
      Effect.provide(compiled.implementation),
      Effect.provide(Layer.succeed(Repo, { prefix: "test:" })),
      Effect.provide(HttpServer.layerServices),
      Effect.scoped,
    ),
  );
});

const Output = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value),
    encode: SchemaGetter.transformEffect((value: string) =>
      Effect.map(Codec, (codec) => value + codec.suffix),
    ),
  }),
);
const codecService = Brick.service("codec", {
  actions: {
    encode: Brick.action("encode", "/encode", {
      input: Schema.Struct({}),
      output: Output,
      errors: [],
    })(() => Effect.succeed("value")),
  },
});
function codecNegative() {
  // @ts-expect-error schema encoding services must be supplied
  Brick.app({ services: [codecService], layer: Layer.empty });
}
void codecNegative;

test("schema services and the current HTTP request reach each invocation", async () => {
  const requests = Brick.service("requests", {
    actions: {
      current: Brick.action("current", "/current", {
        input: Schema.Struct({}),
        output: Schema.String,
        errors: [],
      })(() =>
        Effect.map(
          HttpServerRequest.HttpServerRequest,
          (request) => request.headers["x-identity"] ?? "anonymous",
        ),
      ),
    },
  });
  const app = Brick.app({
    services: [codecService, requests],
    layer: Layer.succeed(Codec, { suffix: "!" }),
  });
  try {
    expect(await (await post(app, "/encode", {})).json()).toBe("value!");
    for (const identity of ["alice", "bob"]) {
      const response = await app.fetch(
        new Request("http://localhost/current", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-identity": identity,
          },
          body: "{}",
        }),
      );
      expect(await response.json()).toBe(identity);
    }
  } finally {
    await app.dispose();
  }
});

test("policy composition runs for local and native HTTP calls", async () => {
  const protectedAction = Brick.action("guarded", "/guarded", {
    input: Schema.Struct({ allowed: Schema.Boolean }),
    output: Schema.String,
    errors: [Brick.errors.Forbidden],
  })((input) =>
    Effect.gen(function* () {
      if (!input.allowed)
        return yield* new Brick.errors.Forbidden({ message: "denied" });
      return "allowed";
    }),
  );
  const local = await Effect.runPromise(
    protectedAction.handler({ allowed: false }).pipe(Effect.flip),
  );
  expect(local).toBeInstanceOf(Brick.errors.Forbidden);
  const app = Brick.app({
    services: [
      Brick.service("policy", { actions: { guarded: protectedAction } }),
    ],
    layer: Layer.empty,
  });
  try {
    expect((await post(app, "/guarded", { allowed: false })).status).toBe(403);
    expect(await (await post(app, "/guarded", { allowed: true })).json()).toBe(
      "allowed",
    );
  } finally {
    await app.dispose();
  }
});

test("defects and invalid encoded output return redacted server errors", async () => {
  const broken = Brick.service("broken", {
    actions: {
      defect: Brick.action("defect", "/defect", {
        input: Schema.Struct({}),
        output: Schema.String,
        errors: [],
      })(() => Effect.die(new Error("private-credential"))),
      invalid: Brick.action("invalid", "/invalid", {
        input: Schema.Struct({}),
        output: Schema.Finite,
        errors: [],
      })(() => Effect.succeed(Number.NaN)),
    },
  });
  const app = Brick.app({ services: [broken], layer: Layer.empty });
  try {
    const defect = await post(app, "/defect", {});
    expect(defect.status).toBe(500);
    expect(await defect.text()).not.toContain("private-credential");
    expect((await post(app, "/invalid", {})).status).toBe(500);
  } finally {
    await app.dispose();
  }
});

test("aborting a request interrupts its handler and releases request resources", async () => {
  let acquired!: () => void;
  let released!: () => void;
  const acquisition = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const release = new Promise<void>((resolve) => {
    released = resolve;
  });
  const waiting = Brick.service("waiting", {
    actions: {
      wait: Brick.action("wait", "/wait", {
        input: Schema.Struct({}),
        output: Schema.String,
        errors: [],
      })(() =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.sync(acquired), () =>
            Effect.sync(released),
          );
          return yield* Effect.never;
        }),
      ),
    },
  });
  const app = Brick.app({ services: [waiting], layer: Layer.empty });
  const abort = new AbortController();
  try {
    const pending = app.fetch(
      new Request("http://localhost/wait", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: abort.signal,
      }),
    );
    await acquisition;
    abort.abort();
    await release;
    const response = await pending;
    expect(response.status).toBe(499);
  } finally {
    await app.dispose();
  }
});

test("composition rejects ambiguous action keys, service names and routes", () => {
  expect(() => Brick.service("wrong", { actions: { other: lookup } })).toThrow(
    "Action key and identifier differ",
  );
  expect(() =>
    Brick.app({
      services: [pages, pages],
      layer: Layer.succeed(Repo, { prefix: "" }),
    }),
  ).toThrow("Duplicate service: pages");
  const duplicate = Brick.service("duplicate", { actions: { lookup } });
  expect(() =>
    Brick.app({
      services: [pages, duplicate],
      layer: Layer.succeed(Repo, { prefix: "" }),
    }),
  ).toThrow("Duplicate route: POST /lookup");
  const extended = Brick.service("pages", {
    actions: { ...pages.actions, ...admin.actions },
  });
  expect(Object.keys(pages.actions)).toEqual(["lookup"]);
  expect(Object.keys(extended.actions)).toEqual(["lookup", "flag"]);
  expect(Object.isFrozen(extended.actions)).toBe(true);
});

test("contracts expose native schemas before a server handler is attached", () => {
  expect(define.endpoint.identifier).toBe("lookup");
  expect(define.name).toBe("lookup");
  expect(define.path).toBe("/lookup");
  expect(define.mcp).toBe(true);
  expect(lookup.endpoint).toBe(define.endpoint);
  expect(lookup.rpc).toBe(define.rpc);
  expect(lookup.tool).toBe(define.tool);
  expect(Object.isFrozen(define)).toBe(true);
});
