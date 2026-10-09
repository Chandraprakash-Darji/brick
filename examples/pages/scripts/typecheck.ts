import { createServer } from "vite";

// Generate the client contract through the normal Vite plugin before checking types.
const server = await createServer({ server: { middlewareMode: true } });
await server.close();
const check = Bun.spawn(["tsc", "--noEmit", "-p", "tsconfig.json"], {
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await check.exited);
