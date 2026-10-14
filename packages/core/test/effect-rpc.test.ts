import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { defineService, t } from "../src/effect";
import {
  createEffectMcpRegistry,
  createEffectServiceProxy,
} from "../src/effect-rpc";
import { UnknownToolError } from "../src/mcp";
import { defineService as definePromiseService } from "../src/service";

class Identity extends Context.Tag("effect-rpc-test/Identity")<
  Identity,
  { name: string }
>() {}
const identity = Layer.succeed(Identity, { name: "shared" });
let sequence = 0;
const name = () => `native_rpc_${++sequence}`;

describe("native Effect dispatch", () => {
  it("preserves the caller layer across nested actions and isolated receiving context", async () => {
    const receiver = defineService(name(), {
      context: (): Effect.Effect<
        { receiver: string; user?: string },
        never,
        Identity
      > => Effect.map(Identity, (value) => ({ receiver: value.name })),
    });
    receiver.action({
      name: "read",
      input: t.Object({ value: t.String() }),
      output: t.String(),
      execute: ({ input, ctx }) =>
        Effect.map(
          Identity,
          (value) => `${ctx.receiver}:${value.name}:${input.value}:${ctx.user}`,
        ),
    });
    const proxy = createEffectServiceProxy<{
      read(
        input: { value: string },
        ctx?: { user?: string },
      ): Effect.Effect<string, unknown, Identity>;
    }>(receiver.name);
    const caller = defineService(name(), {
      context: () => Effect.map(Identity, () => ({ user: "caller" })),
    });
    const action = caller.action({
      name: "nested",
      output: t.String(),
      execute: ({ ctx }) =>
        proxy.read({ value: "payload" }, { user: ctx.user }),
    });
    expect(
      await Effect.runPromise(
        Effect.provide(action.executeEffect({}), identity),
      ),
    ).toBe("shared:shared:payload:caller");
  });

  it("composes MCP tools without an application-owned runtime and reports unknown tools", async () => {
    const service = defineService(name(), {
      context: () =>
        Effect.map(Identity, (value) => ({ receiver: value.name })),
    });
    service.tool({
      name: "nativeRpcEcho",
      input: t.Object({ value: t.String() }),
      output: t.String(),
      execute: ({ input, ctx }) =>
        Effect.map(
          Identity,
          (value) => `${ctx.receiver}:${value.name}:${input.value}`,
        ),
    });
    const registry = createEffectMcpRegistry<Identity>({ services: [service] });
    expect(
      await Effect.runPromise(
        Effect.provide(
          registry.callToolEffect("nativeRpcEcho", { value: "tool" }),
          identity,
        ),
      ),
    ).toBe("shared:shared:tool");
    const missing = await Effect.runPromise(
      Effect.provide(Effect.flip(registry.callToolEffect("absent")), identity),
    );
    expect(missing).toBeInstanceOf(UnknownToolError);
    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      "nativeRpcEcho",
    ]);
    await expect(registry.callTool("absent")).rejects.toBeInstanceOf(
      UnknownToolError,
    );
  });

  it("dispatches Promise actions through the native proxy and reports missing services/actions", async () => {
    const service = definePromiseService(name());
    service.action({ name: "value", execute: async () => "legacy" });
    const proxy = createEffectServiceProxy<{
      value(): Promise<string>;
      absent(): string;
    }>(service.name);
    expect(await Effect.runPromise(proxy.value())).toBe("legacy");
    const missing = await Effect.runPromise(Effect.flip(proxy.absent()));
    expect(missing).toBeInstanceOf(Error);
    const unregistered = createEffectServiceProxy<{ absent(): string }>(name());
    const noService = await Effect.runPromise(
      Effect.flip(unregistered.absent()),
    );
    expect(noService).toBeInstanceOf(Error);
  });
});
