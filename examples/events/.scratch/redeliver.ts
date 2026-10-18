import { buildWorkflows, registerWorkflowTransform } from "../../../packages/cli/src/workflows";
const root = process.cwd();
await registerWorkflowTransform(root);
await buildWorkflows({ root });
const { createWorld } = await import("@brickkit/redis-world");
const { createOrdersApp } = await import("../src/create-app");
const { createCarrier } = await import("../src/carrier");
const { notifications, outbox } = await import("../src/schema");

const world: any = createWorld({ redis: "redis://localhost:6379", keyPrefix: `redeliver:${crypto.randomUUID()}:` });
const carrier = createCarrier();
const realBook = carrier.book;
let calls = 0;
carrier.book = async (id: string) => { calls++; if (calls === 2) console.log("SECOND BOOKING STACK:\n" + new Error().stack?.split("\n").slice(1, 14).join("\n")); return realBook(id); };
const { app, database } = createOrdersApp({ path: ":memory:", carrier, world, dispatch: { timer: false } });
const call = async (path: string, method: string, body?: unknown) =>
  (await app.handle(new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }))).json();
const db: any = database.getDb();
const order = await call("/api/order", "POST", { customer: "ada@example.com", totalCents: 100 });
await call(`/api/order/${order.id}`, "PATCH", { data: { status: "shipped" } });
await app.events!.drain();
const wait = async (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i++) { if ((await db.select().from(notifications)).some((n: any) => n.kind === "shipped")) break; await wait(100); }
const list = async () => (await world.runs.list({ pagination: { limit: 50 } })).data.map((r: any) => `${r.runId} ${r.status}`);
console.log("runs after first delivery:", await list());
console.log("bookings:", carrier.bookings.length);

db.update(outbox).set({ status: "pending", deliveredAt: null }).run();
await app.events!.drain();
await wait(2500);
console.log("runs after redelivery:", await list());
console.log("bookings:", carrier.bookings.length);
const fulfil = (await db.select().from(outbox)).find((r: any) => r.listener === "fulfilment");
const runId = `wrun_${world.createRunId({ runKey: fulfil.id, runKeyTime: fulfil.occurredAt.getTime() })}`;
const events = await world.events.list({ runId, pagination: { limit: 100 } });
console.log("events of the run:", events.data.map((e: any) => e.eventType));
await app.events!.stop();
process.exit(0);
