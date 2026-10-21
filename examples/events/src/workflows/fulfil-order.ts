import type { WorkflowEvent } from "@brickkit/core";
import { RetryableError, sleep } from "workflow";
import { ordersContext } from "../context";
import { notifications, type OrderRow } from "../schema";

type OrderUpdated = { id: string; before: OrderRow; after: OrderRow };

/**
 * Runs once for each `order.update` event. When the order has just shipped it
 * books the carrier, waits, and tells the customer. Each step is retried by the
 * Workflow SDK, and the run survives a restart of the process in between.
 */
export async function fulfilOrder(event: WorkflowEvent<OrderUpdated>) {
  "use workflow";
  const { before, after } = event.payload;
  if (before.status === after.status || after.status !== "shipped")
    return { skipped: true as const };

  const trackingId = await bookCarrier(after.id);
  await sleep("1s");
  await notifyCustomer(event.deliveryId, after, trackingId);
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
  order: OrderRow,
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
