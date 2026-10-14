import { expect, test, spyOn } from "bun:test";
import {
  defineAction,
  defineService,
  t,
  brick,
  generateOpenApiSpec,
  ActionExecutionError,
  ValidationError,
  createEndpointHandler,
  compileBrickApplication,
  compileRoutePlan,
  emitHandlerFactory,
  compilerRuntime,
} from "../src";
import { createBrickClient } from "../src/client";

for (const compiler of [true, false]) {
  for (const scenario of [
    "declared",
    "validation",
    "anonymous",
    "signed-in",
    "unexpected",
  ] as const) {
    test(`error parity (${compiler ? "compiled" : "generic"}): ${scenario}`, async () => {
      const action = defineAction({
        name: "fail",
        input: t.Object({ value: t.String() }),
        errors: { TAKEN: { message: "Taken", status: 409 } },
        authorize: () => scenario !== "anonymous" && scenario !== "signed-in",
        execute: ({ error }) => {
          if (scenario === "declared") error.TAKEN();
          throw new Error("private database password", {
            cause: new Error("root cause"),
          });
        },
      });
      const service = defineService(`errors_${scenario}`, {
        context: () => ({
          user: scenario === "signed-in" ? { id: "u" } : undefined,
        }),
      }).action(action);
      const app = brick({
        services: [service],
        requestLogging: false,
        compiler,
      });
      const input = { value: scenario === "validation" ? 1 : "ok" };
      const expected =
        scenario === "declared"
          ? { code: "TAKEN", status: 409 }
          : scenario === "validation"
            ? { code: "VALIDATION_FAILED", status: 400 }
            : scenario === "anonymous"
              ? { code: "UNAUTHORIZED", status: 401 }
              : scenario === "signed-in"
                ? { code: "FORBIDDEN", status: 403 }
                : { code: "INTERNAL_SERVER_ERROR", status: 500 };
      const log = spyOn(console, "error").mockImplementation(() => {});
      try {
        const local = await action
          .execute({ input: input as never })
          .catch((error) => error);
        expect(local).toMatchObject(expected);
        const response = await app.handle(
          new Request(`http://localhost/api/${service.name}/fail`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": "test-request",
            },
            body: JSON.stringify(input),
          }),
        );
        const envelope = await response.json();
        expect(response.status).toBe(expected.status);
        expect(envelope).toMatchObject({
          ...expected,
          requestId: "test-request",
        });
        const client = createBrickClient<{ errors: { fail: typeof action } }>({
          baseUrl: "http://localhost",
          contract: { errors: { fail: action } },
          fetch: async (url, init) =>
            app.handle(new Request(String(url), init)),
        });
        const remote = await client.errors
          .fail(input as never)
          .catch((error) => error);
        expect(remote).toMatchObject(expected);
        if (scenario === "validation")
          expect(remote).toBeInstanceOf(ValidationError);
        if (scenario === "unexpected") {
          expect(JSON.stringify(envelope)).not.toContain(
            "private database password",
          );
          expect(log).toHaveBeenCalled();
        }
      } finally {
        log.mockRestore();
      }
    });
  }
}
test("endpoint errors redact internals and include request id", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const cause = new Error("private failure");
  try {
    const handler = createEndpointHandler(
      {
        method: "GET",
        path: "/fail",
        handler: () => {
          throw cause;
        },
      },
      [],
    );
    const result = await handler({
      set: { headers: {} },
      headers: { "x-request-id": "endpoint-id" },
    });
    expect(result).toMatchObject({
      name: "InternalServerError",
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal Server Error",
      status: 500,
      requestId: "endpoint-id",
    });
    expect(log.mock.calls.flat()).toContain(cause);
  } finally {
    log.mockRestore();
  }
});
test("declared errors retain causes without serializing them", async () => {
  const cause = new Error("secret");
  const action = defineAction({
    name: "cause",
    execute: ({ error }) => error.CONFLICT("taken", { id: 1 }, { cause }),
  });
  defineService("cause_errors").action(action);
  const failure = await action.execute({}).catch((error) => error);
  expect(failure).toBeInstanceOf(ActionExecutionError);
  expect(failure.cause).toBe(cause);
  expect(JSON.stringify(failure)).not.toContain("secret");
});
test("OpenAPI groups declared errors and uses shared envelopes", () => {
  const service = defineService("spec_errors").action(
    defineAction({
      name: "fail",
      authorize: () => false,
      errors: {
        FIRST: { status: 409, message: "First" },
        SECOND: { status: 409, message: "Second" },
      },
      execute: () => "ok",
    }),
  );
  const spec = generateOpenApiSpec({ services: [service] });
  expect(spec.components.schemas.ErrorEnvelope).toBeDefined();
  const responses = spec.paths["/api/spec_errors/fail"].post.responses;
  expect(responses[401]).toBeDefined();
  expect(responses[409].content["application/json"].schema.oneOf).toHaveLength(
    2,
  );
});

test("emitted handler authorization uses the shared envelope", async () => {
  for (const user of [undefined, { id: "guest" }]) {
    const action = defineAction({
      name: "emitted",
      authorize: () => false,
      execute: () => "ok",
    });
    const service = defineService("emitted_errors", {
      context: () => ({ user }),
    }).action(action);
    const route = compileBrickApplication({ services: [service] }).ir
      .routes[0]!;
    const bind = new Function("return (" + emitHandlerFactory(route) + ")")();
    const handler = bind(
      compileRoutePlan(service, action, route.path, route.method),
      compilerRuntime,
    );
    const result = await handler({
      set: { headers: {} },
      headers: { "x-request-id": "emitted-id" },
    });
    expect(result).toMatchObject({
      code: user == null ? "UNAUTHORIZED" : "FORBIDDEN",
      status: user == null ? 401 : 403,
      requestId: "emitted-id",
    });
  }
});

test("emitted handlers redact synchronous and asynchronous failures and log causes", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const cause = new Error("private root cause");
  try {
    for (const asynchronous of [false, true]) {
      const failure = new Error("private database password", { cause });
      const action = defineAction({
        name: "failure",
        execute: () => {
          if (asynchronous) return Promise.reject(failure);
          throw failure;
        },
      });
      const service = defineService("emitted_failure").action(action);
      const route = compileBrickApplication({ services: [service] }).ir
        .routes[0]!;
      const bind = new Function("return (" + emitHandlerFactory(route) + ")")();
      const handler = bind(
        compileRoutePlan(service, action, route.path, route.method),
        compilerRuntime,
      );
      const result = await handler({
        set: { headers: {} },
        headers: { "x-request-id": "emitted-failure-id" },
      });
      expect(result).toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        message: "Internal Server Error",
        requestId: "emitted-failure-id",
      });
      expect(JSON.stringify(result)).not.toContain("private");
      expect(log.mock.calls.flat()).toContain(failure);
      expect(failure.cause).toBe(cause);
    }
  } finally {
    log.mockRestore();
  }
});
