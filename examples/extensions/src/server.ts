import { app } from "./app";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  fetch: app.fetch,
});
const stop = async () => {
  await server.stop(true);
  await app.dispose();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
console.log(`Comments listening on http://localhost:${server.port}`);
