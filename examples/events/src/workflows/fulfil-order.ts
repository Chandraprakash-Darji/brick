import type { WorkflowEvent } from "@brickkit/core";
import { RetryableError, sleep } from "workflow";
import { ordersContext } from "../context";
import { notifications } from "../schema";

type Shipped = { id: string; customer: string };

/**
 * Runs once for each `orders.shipped` event: books the carrier, waits, and tells
 * the customer. Each step is retried by the Workflow SDK, and the run survives a
 * restart of the process in between.
 */
export async function fulfilOrder(event: WorkflowEvent<Shipped>) {
  "use workflow";
  const order = event.payload;
  const trackingId = await bookCarrier(order.id);
  await sleep("1s");
  await notifyCustomer(event.deliveryId, order, trackingId);
  return { trackingId };
}

async function bookCarrier(orderId: string) {
  "use step";
  try {
    return await ordersContext().carrier.book(orderId);
  } catch (error) {
    throw new RetryableError((error as Error).message, { retryAfter: 100 });
  }
}

async function notifyCustomer(
  deliveryId: string,
  order: Shipped,
  trackingId: string,
) {
  "use step";
  await ordersContext()
    .db.insert(notifications)
    .values({
      id: deliveryId,
      kind: "shipped",
      orderId: order.id,
      recipient: order.customer,
      detail: trackingId,
    })
    .onConflictDoNothing();
}
