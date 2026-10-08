import { defineService, eq } from "@brickkit/core";

import { getAuth } from "../../../auth";
import { appDb } from "../../../db";
import { pagesTable } from "./model";

export * from "./model";

// 2. Define Service with the shared Postgres database + better-auth session loading.
// The context resolver runs once per request: it reads the session cookie
// (or bearer token) via better-auth and injects user/session for all actions.
export const pagesService = defineService("pages", {
  context: async ({ request }) => {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    return {
      session: session?.session ?? null,
      user: session?.user ?? null,
    };
  },
  database: appDb,
});

// 3. Attach Resource at Service Level (Automatic CRUD & Schema Registration)
export const pagesResource = pagesService.resource({
  hooks: {
    beforeCreate: async ({ data, ctx, error }) => {
      // Validate unique slug before writing
      const exists = await ctx.db
        .select()
        .from(pagesTable)
        .where(eq(pagesTable.slug, data.slug));
      if (exists.length > 0) {
        error.CONFLICT(`Slug '${data.slug}' is already taken`);
      }
    },
  },
  name: "page",
  operations: {
    create: true,
    delete: true,
    get: true,
    list: { defaultLimit: 20, maxLimit: 100 },
    update: true,
  },
  ownerField: "userId",
  table: pagesTable,
});

// Go OwnerAccess parity: every CRUD op requires sign-in. The framework's
// ServiceOptions.auth is introspection-only (no enforcement), and resources
// take no authorize option, so attach the guard to the generated actions.
// defineAction reads config.authorize at execution time, so late binding works.
const requireSignedIn = ({ user }: { user?: { id?: string } | null }) =>
  !!user?.id;
for (const action of Object.values(pagesResource.actions)) {
  (action.config as { authorize?: unknown }).authorize = requireSignedIn;
}
