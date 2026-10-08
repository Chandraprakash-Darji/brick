// Only Drizzle Kit reads this configuration. The app never runs it.
// Reads process.env directly (no ./src/secrets import): drizzle-kit loads
// this file with require(), and @brickkit/core is ESM-only ("import"
// condition, no "require"), so importing app code here crashes with
// "No 'exports' main defined". Keep this file dependency-free.
export default {
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/drafton",
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/api/schema.ts",
};
