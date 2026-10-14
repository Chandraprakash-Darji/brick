import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { brick, createMcpRegistry, defineService, t } from "../src/effect";

class Greeting extends Context.Tag("effect-service-test/Greeting")<
  Greeting,
  { text: string }
>() {}
const greeting = Layer.succeed(Greeting, { text: "hello" });
let sequence = 0;
const name = () => `native_service_${++sequence}`;

describe("native Effect services", () => {
  for (const compiler of [true, false]) {
    it(`shares dependencies through context, actions and tools with compiler=${compiler}`, async () => {
      let contexts = 0;
      const service = defineService(name(), {
        context: () =>
          Effect.map(Greeting, (value) => {
            contexts++;
            return { greeting: value.text };
          }),
      });
      service.action({
        name: "hello",
        output: t.String(),
        execute: ({ ctx }) =>
          Effect.map(Greeting, (value) => `${ctx.greeting}:${value.text}`),
      });
      const tool = service.tool({
        name: "echo",
        input: t.Object({ text: t.String() }),
        output: t.String(),
        annotations: { readOnlyHint: true },
        execute: ({ input, ctx }) =>
          Effect.map(
            Greeting,
            (value) => `${input.text}:${ctx.greeting}:${value.text}`,
          ),
      });
      expect(tool.kind).toBe("tool");
      const app = brick({ services: [service], layer: greeting, compiler });
      try {
        const response = await app.handle(
          new Request(`http://localhost/api/${service.name}/hello`, {
            method: "POST",
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello:hello");
        expect(contexts).toBe(1);
        const registry = createMcpRegistry({ services: [service] });
        expect(await registry.callTool("echo", { text: "request" })).toBe(
          "request:hello:hello",
        );
        expect(contexts).toBe(2);
      } finally {
        await app.dispose();
      }
    });
  }

  it("denies Effect authorization before executing and accepts Promise registrations", async () => {
    const service = defineService(name());
    let executed = false;
    service.action({
      name: "deny",
      authorize: () => Effect.succeed(false),
      execute: () =>
        Effect.sync(() => {
          executed = true;
          return "unreachable";
        }),
    });
    const legacy = service.action({
      name: "legacy",
      output: t.String(),
      execute: async () => "promise",
    });
    const app = brick({ services: [service] });
    try {
      const response = await app.handle(
        new Request(`http://localhost/api/${service.name}/deny`, {
          method: "POST",
        }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(executed).toBe(false);
      expect(await legacy({})).toBe("promise");
      const legacyResponse = await app.handle(
        new Request(`http://localhost/api/${service.name}/legacy`, {
          method: "POST",
        }),
      );
      expect(legacyResponse.status).toBe(200);
      expect(await legacyResponse.text()).toBe("promise");
    } finally {
      await app.dispose();
    }
  });

  it("composes context and action using the caller-provided Effect layer", async () => {
    const service = defineService(name(), {
      context: () =>
        Effect.map(Greeting, (value) => ({ greeting: value.text })),
    });
    const action = service.action({
      name: "compose",
      output: t.String(),
      execute: ({ ctx }) =>
        Effect.map(Greeting, (value) => `${ctx.greeting}:${value.text}`),
    });
    const program = Effect.gen(function* () {
      const ctx = yield* service.resolveContextEffect();
      return yield* action.executeEffect({ ctx });
    });
    expect(await Effect.runPromise(Effect.provide(program, greeting))).toBe(
      "hello:hello",
    );
    const value = await Effect.runPromise(
      Effect.provide(action.executeEffect({}), greeting),
    );
    const valid: string = value;
    expect(valid).toBe("hello:hello");
    // @ts-expect-error The output schema keeps native output typed as string.
    const invalid: number = value;
    void invalid;
  });

  it("infers action and tool dependencies independently of service context", async () => {
    const service = defineService(name());
    const action = service.action({
      name: "independent",
      output: t.String(),
      execute: () => Effect.map(Greeting, (value) => value.text),
    });
    const tool = service.tool({
      name: "independentTool",
      output: t.String(),
      execute: () => Effect.map(Greeting, (value) => value.text),
    });
    const program = action.executeEffect({});
    // @ts-expect-error Native registration preserves the required dependency.
    const withoutDependencies: Effect.Effect<string, unknown, never> = program;
    void withoutDependencies;
    const value: string = await Effect.runPromise(
      Effect.provide(program, greeting),
    );
    expect(value).toBe("hello");
    expect(
      await Effect.runPromise(Effect.provide(tool.executeEffect({}), greeting)),
    ).toBe("hello");
  });
});
