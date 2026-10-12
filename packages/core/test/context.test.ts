import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  defineDatabase,
  createServiceProxy,
  t,
  resetGlobalRegistry,
} from "../src";

// Mock User and Session types mirroring Better Auth
interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

// Mock Better Auth client
const mockAuth = {
  api: {
    getSession: async ({
      headers,
    }: {
      headers: Headers;
    }): Promise<{ user: User; session: Session } | null> => {
      const authHeader = headers.get("authorization");
      if (authHeader === "Bearer valid-token") {
        return {
          user: {
            id: "usr_alice",
            email: "alice@example.com",
            name: "Alice Smith",
            role: "admin",
          },
          session: {
            id: "sess_123",
            userId: "usr_alice",
            expiresAt: new Date(Date.now() + 3600000),
          },
        };
      }
      return null;
    },
  },
};

describe("Service-Level Context Resolution & Session Injection", () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  it("should declare service-level context with Better Auth session injection", async () => {
    // 1. Define service with context hook
    const docsService = defineService("docs", {
      database: defineDatabase(),
      context: async ({ request }) => {
        // Resolve authentication session once per request from request.headers
        const session = await mockAuth.api.getSession({
          headers: request.headers,
        });

        return {
          user: session?.user ?? null,
          session: session?.session ?? null,
          isOwner: (ownerId: string) => session?.user?.id === ownerId,
        };
      },
    });

    // 2. Define action with authorize guard and type narrowing
    const createDoc = docsService.action({
      name: "createDoc",
      input: t.Object({
        title: t.String(),
        content: t.String(),
      }),
      output: t.Object({
        id: t.String(),
        title: t.String(),
        authorEmail: t.String(),
        authorRole: t.String(),
        isOwner: t.Boolean(),
      }),
      // Authorize reads from resolved context
      authorize: ({ ctx }) => {
        return ctx.user !== null;
      },
      // In execute, ctx.user is strictly narrowed from User | null to User!
      execute: async ({ input, ctx }) => {
        // Compile-time check: ctx.user is non-null User
        const author: User = ctx.user;
        const owns = ctx.isOwner(author.id);

        return {
          id: "doc_1",
          title: input.title,
          authorEmail: author.email,
          authorRole: author.role,
          isOwner: owns,
        };
      },
    });

    // 3. Test unauthenticated invocation directly via .run()
    expect(
      createDoc.run({
        title: "Secret Doc",
        content: "Draft",
      }),
    ).rejects.toThrow("Access denied for action 'createDoc'");

    // 4. Test zero-mock unit testing ergonomics with injected mock context
    const mockUser: User = {
      id: "usr_test_99",
      email: "tester@brick.dev",
      name: "Test Runner",
      role: "member",
    };

    const result = await createDoc.run(
      {
        title: "My Architecture Doc",
        content: "# Hello World",
      },
      {
        user: mockUser,
        session: {
          id: "sess_mock",
          userId: mockUser.id,
          expiresAt: new Date(),
        },
        isOwner: (id: string) => id === mockUser.id,
      },
    );

    expect(result).toBeDefined();
    expect(result.title).toBe("My Architecture Doc");
    expect(result.authorEmail).toBe("tester@brick.dev");
    expect(result.authorRole).toBe("member");
    expect(result.isOwner).toBe(true);
  });

  it("should run the context hook once and resolve sessions via request headers", async () => {
    let contextResolutionCount = 0;

    const securedService = defineService("secured", {
      context: async ({ request }) => {
        contextResolutionCount++;
        const session = await mockAuth.api.getSession({
          headers: request.headers,
        });
        return {
          user: session?.user ?? null,
          session: session?.session ?? null,
        };
      },
    });

    const getProfile = securedService.action({
      name: "getProfile",
      authorize: ({ ctx }) => ctx.user !== null,
      execute: async ({ ctx }) => {
        return {
          userId: ctx.user.id,
          email: ctx.user.email,
        };
      },
    });

    // Invoke with valid Bearer token via custom request
    const authedRequest = new Request(
      "http://localhost/api/secured/getProfile",
      {
        headers: {
          authorization: "Bearer valid-token",
        },
      },
    );

    const authedResult = await getProfile.execute({
      ctx: { request: authedRequest },
    });

    expect(authedResult.userId).toBe("usr_alice");
    expect(authedResult.email).toBe("alice@example.com");
    expect(contextResolutionCount).toBe(1);

    // Invoke with invalid / missing token
    const unauthedRequest = new Request(
      "http://localhost/api/secured/getProfile",
      {
        headers: {
          authorization: "Bearer invalid-token",
        },
      },
    );

    expect(
      getProfile.execute({
        ctx: { request: unauthedRequest },
      }),
    ).rejects.toThrow("Access denied for action 'getProfile'");
  });

  it("should keep ctx.user as User | null when action has no authorize guard", async () => {
    const publicService = defineService("public", {
      context: async ({ request }) => {
        const session = await mockAuth.api.getSession({
          headers: request.headers,
        });
        return {
          user: session?.user ?? null,
        };
      },
    });

    const getStatus = publicService.action({
      name: "getStatus",
      execute: async ({ ctx }) => {
        // When authorize is not present, ctx.user is User | null
        const currentUser: User | null = ctx.user;
        return {
          status: "online",
          authenticated: currentUser !== null,
          user: currentUser ? currentUser.email : "anonymous",
        };
      },
    });

    const anon = await getStatus.run();
    expect(anon.authenticated).toBe(false);
    expect(anon.user).toBe("anonymous");

    const authed = await getStatus.run(undefined, {
      user: {
        id: "usr_bob",
        email: "bob@example.com",
        name: "Bob",
        role: "member",
      },
    });
    expect(authed.authenticated).toBe(true);
    expect(authed.user).toBe("bob@example.com");
  });

  it("should isolate context when one service calls another (orders -> billing)", async () => {
    // Track which database each service uses
    const ordersDbCalls: string[] = [];
    const billingDbCalls: string[] = [];

    // Create orders service with its own database
    const ordersDb = defineDatabase();
    const ordersService = defineService("orders", {
      database: ordersDb,
      context: async () => ({
        serviceName: "orders",
        dbName: "orders_db",
      }),
    });

    // Create billing service with its own database and context resolver
    const billingDb = defineDatabase();
    const billingService = defineService("billing", {
      database: billingDb,
      context: async () => {
        // This context resolver should run when billing actions are called
        return {
          serviceName: "billing",
          dbName: "billing_db",
          resolverRan: true,
        };
      },
    });

    // Billing action that tracks which database and context it sees
    billingService.action({
      name: "charge",
      input: t.Object({ amount: t.Number() }),
      output: t.Object({
        success: t.Boolean(),
        dbName: t.String(),
        serviceName: t.String(),
        resolverRan: t.Boolean(),
        userId: t.Optional(t.String()),
      }),
      execute: async ({ ctx }) => {
        billingDbCalls.push(ctx.dbName);
        return {
          success: true,
          dbName: ctx.dbName,
          serviceName: ctx.serviceName,
          resolverRan: ctx.resolverRan === true,
          userId: ctx.user?.id,
        };
      },
    });

    // Orders action that calls billing
    const createOrderAction = ordersService.action({
      name: "createOrder",
      input: t.Object({ amount: t.Number() }),
      output: t.Object({
        orderId: t.String(),
        chargeResult: t.Object({
          success: t.Boolean(),
          dbName: t.String(),
          serviceName: t.String(),
          resolverRan: t.Boolean(),
          userId: t.Optional(t.String()),
        }),
      }),
      execute: async ({ input, ctx }) => {
        ordersDbCalls.push(ctx.dbName);

        // Call billing service from orders
        const billingRpc = createServiceProxy("billing");
        const chargeResult = await billingRpc.charge(
          { amount: input.amount },
          {
            // Pass only safe envelope fields
            user: { id: "usr_alice" } as any,
            traceId: "tr_envelope_123",
            requestId: "req_envelope_456",
          },
        );

        return {
          orderId: "order_1",
          chargeResult,
        };
      },
    });

    // Execute orders action which internally calls billing
    const result = await createOrderAction.run(
      { amount: 100 },
      {
        user: { id: "usr_alice" } as any,
      },
    );

    // Verify orders uses its own database
    expect(ordersDbCalls).toContain("orders_db");

    // Verify billing uses ITS OWN database, not orders'
    expect(billingDbCalls).toContain("billing_db");
    expect(billingDbCalls).not.toContain("orders_db");

    // Verify billing's context resolver ran
    expect(result.chargeResult.resolverRan).toBe(true);
    expect(result.chargeResult.serviceName).toBe("billing");
    expect(result.chargeResult.dbName).toBe("billing_db");

    // Verify user was preserved through the inter-service call
    expect(result.chargeResult.userId).toBe("usr_alice");
  });

  it("should prevent caller context fields from overriding receiver's database", async () => {
    const billingService = defineService("billing", {
      database: defineDatabase(),
      context: async () => ({
        isValidDatabase: true,
      }),
    });

    billingService.action({
      name: "getContext",
      output: t.Object({
        isValidDatabase: t.Boolean(),
        db: t.Optional(t.Any()),
      }),
      execute: async ({ ctx }) => ({
        isValidDatabase: ctx.isValidDatabase === true,
        db: ctx.db ? "received_valid_db" : "no_db",
      }),
    });

    const billingRpc = createServiceProxy("billing");

    // Attempt to pass a fake database in callCtx - it should be ignored
    const result = await billingRpc.getContext(
      {},
      {
        db: { isFake: true } as any,
        dbName: "caller_db",
        resolverRan: false,
      },
    );

    // Verify that billing's context resolver ran and set isValidDatabase
    expect(result.isValidDatabase).toBe(true);
    // Verify that the fake db from caller was not used
    // (billing has its own database and should reject the caller's db)
    expect(result.db).not.toBe("isFake");
  });
});
