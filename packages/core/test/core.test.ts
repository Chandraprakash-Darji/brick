import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  defineAction,
  createServiceProxy,
  getGlobalRegistry,
  resetGlobalRegistry,
  t,
  ValidationError,
  ActionExecutionError,
} from "../src";

describe("@brick-ts/core Engine", () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  it("should define and register a service with actions", async () => {
    const dealsService = defineService("deals", { database: true });

    const createDeal = defineAction({
      name: "createDeal",
      input: t.Object({
        title: t.String({ minLength: 3 }),
        amount: t.Number({ minimum: 0 }),
      }),
      output: t.Object({
        id: t.String(),
        title: t.String(),
        amount: t.Number(),
        status: t.String(),
      }),
      execute: async ({ input, ctx }) => {
        expect(ctx.traceId).toBeDefined();
        return {
          id: "deal_123",
          title: input.title,
          amount: input.amount,
          status: "pending",
        };
      },
    });

    dealsService.action(createDeal);

    const registry = getGlobalRegistry();
    expect(registry.has("deals")).toBe(true);

    const introspect = dealsService.introspect();
    expect(introspect.name).toBe("deals");
    expect(introspect.hasDatabase).toBe(true);
    expect(introspect.actions.length).toBe(1);
    expect(introspect.actions[0].name).toBe("createDeal");
  });

  it("should validate input schema correctly", async () => {
    const mathService = defineService("math");

    const divideAction = defineAction({
      name: "divide",
      input: t.Object({
        a: t.Number(),
        b: t.Number(),
      }),
      output: t.Object({
        result: t.Number(),
      }),
      errors: {
        DIVISION_BY_ZERO: { status: 400, message: "Cannot divide by zero" },
      },
      execute: async ({ input, error }) => {
        if (input.b === 0) {
          error.DIVISION_BY_ZERO();
        }
        return { result: input.a / input.b };
      },
    });

    mathService.action(divideAction);

    // Valid call
    const res = await divideAction({ input: { a: 10, b: 2 } });
    expect(res.result).toBe(5);

    // Invalid input type (string instead of number)
    try {
      // @ts-expect-error test invalid input
      await divideAction({ input: { a: "not a number", b: 2 } });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors.length).toBeGreaterThan(0);
    }

    // Typed domain error
    try {
      await divideAction({ input: { a: 10, b: 0 } });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(ActionExecutionError);
      expect(err.code).toBe("DIVISION_BY_ZERO");
      expect(err.status).toBe(400);
    }
  });

  it("should support in-memory RPC between services with context propagation", async () => {
    const notifyService = defineService("notifications");
    notifyService.action({
      name: "send",
      input: t.Object({ message: t.String() }),
      output: t.Object({ delivered: t.Boolean() }),
      execute: async ({ input, ctx }: any) => {
        expect(ctx.traceId).toBe("tr_custom_123");
        return { delivered: true };
      },
    });

    interface NotifyServiceRpc {
      send: (
        input: { message: string },
        ctx?: any
      ) => Promise<{ delivered: boolean }>;
    }

    const notifyRpc = createServiceProxy<NotifyServiceRpc>("notifications", {
      context: { traceId: "tr_custom_123" },
    });

    const result = await notifyRpc.send({ message: "Hello from RPC!" });
    expect(result.delivered).toBe(true);
  });

  it("should enforce authorization guards when present", async () => {
    const secureService = defineService("secure");
    const secretAction = defineAction({
      name: "getSecret",
      authorize: ({ user }) => user?.role === "admin",
      output: t.Object({ secret: t.String() }),
      execute: async () => ({ secret: "brick-top-secret" }),
    });

    secureService.action(secretAction);

    // Unauthenticated / unauthorized
    try {
      await secretAction({ ctx: { user: { role: "guest" } } });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(ActionExecutionError);
      expect(err.code).toBe("UNAUTHORIZED");
      expect(err.status).toBe(403);
    }

    // Authorized
    const res = await secretAction({ ctx: { user: { role: "admin" } } });
    expect(res.secret).toBe("brick-top-secret");
  });
});
