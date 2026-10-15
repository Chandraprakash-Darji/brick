import { createAuthInstance } from "./index";

// Singleton auth instance for the better-auth CLI (`bun run db:schema`).
// Runtime uses createAuthInstance()/initAuth() directly; this module exists
// only so `auth generate` can discover the configured options and plugins.
export const auth = createAuthInstance();
