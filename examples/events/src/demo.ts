import { createCarrier } from "./carrier";
import { createOrdersApp } from "./create-app";
import { auditLog, notifications } from "./schema";

const carrier = createCarrier({ failures: 1 });
const { app, database } = createOrdersApp({
  path: ":memory:",
  carrier,
  dispatch: { timer: false, maxBackoffMs: 1 },
});
const events = app.events!;

const call = async (path: string, method: string, body?: unknown) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
  return response.json();
};

const order = await call("/api/orders/order", "POST", {
  customer: "ada@example.com",
  totalCents: 4200,
  internalNote: "never leaves the database",
});
console.log("created", order);

console.log(
  "shipped",
  await call(`/api/orders/order/${order.id}/ship`, "POST", {}),
);
console.log("events waiting:", await events.counts());

// The carrier fails once, so the shipping delivery is left waiting for a retry.
console.log("deliveries run:", await events.drain());
console.log("after the first pass:", await events.counts());

await new Promise((resolve) => setTimeout(resolve, 5));
console.log("deliveries run:", await events.drain());
console.log("after the retry:", await events.counts());

const db = database.getDb();
console.log("audit log:", await db.select().from(auditLog));
console.log("notifications:", await db.select().from(notifications));
console.log("carrier bookings:", carrier.bookings);
