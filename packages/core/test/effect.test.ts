import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  defineAction,
  defineEffectAction,
  defineService,
  brick,
  t,
  ValidationError,
  ActionExecutionError,
} from "../src";

describe("Effect actions", () => {
  it("composes lazily and stays callable through Promise and service APIs", async () => {
    let calls = 0;
    const action = defineEffectAction({
      name: "double",
      input: t.Object({ value: t.Number() }),
      output: t.Number(),
      execute: ({ input, ctx }) =>
        Effect.sync(() => {
          calls++;
          expect(ctx.traceId).toBeDefined();
          return input.value * 2;
        }),
    });
    defineService("math").action(action);
    const program = action.executeEffect({ input: { value: 3 } });
    expect(calls).toBe(0);
    expect(await Effect.runPromise(program)).toBe(6);
    expect(await action.run({ value: 4 })).toBe(8);
    expect(await action({ input: { value: 5 } })).toBe(10);
  });

  it("preserves failure identity for native failures and throwing helpers", async () => {
    const failure = new ActionExecutionError("CONFLICT", "Already exists", 409);
    const action = defineEffectAction({
      name: "fail",
      execute: () => Effect.fail(failure),
    });
    expect(await Effect.runPromise(Effect.flip(action.executeEffect({})))).toBe(
      failure,
    );
    try {
      await action({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBe(failure);
    }
    const throwing = defineEffectAction({
      name: "throw",
      execute: ({ error }) => Effect.sync(() => error.NOT_FOUND()),
    });
    await expect(throwing({})).rejects.toBeInstanceOf(ActionExecutionError);
    const promise = defineAction({
      name: "promise",
      execute: () => {
        throw failure;
      },
    });
    try {
      await promise({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBe(failure);
    }
  });

  it("validates before authorization and execution, and validates output", async () => {
    let authorized = 0;
    let executed = 0;
    const action = defineEffectAction({
      name: "validate",
      input: t.Number(),
      output: t.Number({ minimum: 1 }),
      authorize: () => {
        authorized++;
        return false;
      },
      execute: () =>
        Effect.sync(() => {
          executed++;
          return 0;
        }),
    });
    // @ts-expect-error deliberately invalid input
    await expect(action({ input: "bad" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(authorized).toBe(0);
    await expect(action({ input: 1 })).rejects.toBeInstanceOf(
      ActionExecutionError,
    );
    expect(executed).toBe(0);
    const invalidOutput = defineEffectAction({
      name: "output",
      output: t.Number({ minimum: 1 }),
      execute: () => Effect.succeed(0),
    });
    await expect(invalidOutput({})).rejects.toBeInstanceOf(ValidationError);
  });

  it("runs through compiled HTTP handlers and maps domain failures", async () => {
    const service = defineService("effectHttp");
    service.action(
      defineEffectAction({
        name: "hello",
        output: t.String(),
        execute: () => Effect.succeed("hello"),
      }),
    );
    service.action(
      defineEffectAction({
        name: "missing",
        execute: () =>
          Effect.fail(new ActionExecutionError("NOT_FOUND", "Missing", 404)),
      }),
    );
    const app = brick({ services: [service] });
    const ok = await app.handle(
      new Request("http://localhost/api/effectHttp/hello", { method: "POST" }),
    );
    expect(ok.status).toBe(200);
    const missing = await app.handle(
      new Request("http://localhost/api/effectHttp/missing", {
        method: "POST",
      }),
    );
    expect(missing.status).toBe(404);
  });
});
