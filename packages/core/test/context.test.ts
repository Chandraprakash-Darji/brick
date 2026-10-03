import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
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
      database: true,
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
      })
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
      }
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
    const authedRequest = new Request("http://localhost/api/secured/getProfile", {
      headers: {
        authorization: "Bearer valid-token",
      },
    });

    const authedResult = await getProfile.execute({
      ctx: { request: authedRequest },
    });

    expect(authedResult.userId).toBe("usr_alice");
    expect(authedResult.email).toBe("alice@example.com");
    expect(contextResolutionCount).toBe(1);

    // Invoke with invalid / missing token
    const unauthedRequest = new Request("http://localhost/api/secured/getProfile", {
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    expect(
      getProfile.execute({
        ctx: { request: unauthedRequest },
      })
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
});
