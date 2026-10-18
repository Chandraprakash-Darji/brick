import {
  buildWorkflows,
  registerWorkflowTransform,
} from "../../../packages/cli/src/workflows";

const root = process.cwd();
console.log("transform registered:", await registerWorkflowTransform(root));
const t = Date.now();
await buildWorkflows({ root });
console.log("bundle built in", Date.now() - t, "ms");

const { createWorld } = await import("@brickkit/redis-world");
const { createOrdersApp } = await import("../src/create-app");
const { createCarrier } = await import("../src/carrier");
const { notifications } = await import("../src/schema");

const id = crypto.randomUUID();
const world = createWorld({
  redis: "redis://localhost:6379",
  keyPrefix: `smoke:${id}:`,
});
const carrier = createCarrier({ failures: 2 });
const { app, database } = createOrdersApp({
  path: ":memory:",
  carrier,
  world,
  dispatch: { timer: false },
});

const call = async (path: string, method: string, body?: unknown) =>
  (
    await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  ).json();

const order = await call("/api/order", "POST", {
  customer: "ada@example.com",
  totalCents: 100,
});
await call(`/api/order/${order.id}`, "PATCH", { data: { status: "shipped" } });
const events = app.events!;
console.log("deliveries run:", await events.drain());
const db: any = database.getDb();
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  const rows = await db.select().from(notifications);
  if (rows.some((r: any) => r.kind === "shipped")) break;
  await new Promise((r) => setTimeout(r, 200));
}
console.log("notifications:", await db.select().from(notifications));
console.log("bookings:", carrier.bookings, "counts:", await events.counts());
await events.stop();
process.exit(0);
