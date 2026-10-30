import {
  defineListener,
  type EventDelivery,
  type EventRefs,
} from "@brickkit/core";
import type { Carrier } from "./carrier";
import type { orderEvents } from "./events";
import { fulfilOrder } from "./workflows/fulfil-order";
import { auditLog, notifications, type OrderRow } from "./schema";

type Db = {
  insert(table: typeof auditLog | typeof notifications): {
    values(value: Record<string, unknown>): {
      onConflictDoNothing(): PromiseLike<unknown>;
    };
  };
};

type Created = { id: string; row: OrderRow };
type Updated = { id: string; before: OrderRow; after: OrderRow };

function describeChange(before: OrderRow, after: OrderRow): string {
  const changed = (Object.keys(after) as (keyof OrderRow)[])
    .filter((key) => before[key] !== after[key])
    .map((key) => `${key}: ${before[key]} -> ${after[key]}`);
  return changed.join(", ") || "no visible change";
}

/**
 * Every handler writes its row under the delivery id. Delivery is at least once,
 * so a second run of the same delivery must change nothing.
 *
 * Shipping is a plain handler, unless the app has a world to run workflows on: then
 * the `fulfilment` workflow takes its place, and the SDK retries its steps.
 */
export function createListeners(
  db: Db,
  carrier: Carrier,
  events: EventRefs<typeof orderEvents>,
  options: { workflows?: boolean } = {},
) {
  const audit = defineListener({
    name: "audit",
    on: ["order.*", events.shipped],
    run: async (delivery: EventDelivery<any>) => {
      const payload = delivery.payload;
      const detail =
        delivery.name === "order.create"
          ? `placed by ${(payload as Created).row.customer}`
          : delivery.name === "order.update"
            ? describeChange(
                (payload as Updated).before,
                (payload as Updated).after,
              )
            : delivery.name === events.shipped.name
              ? "shipped"
              : "deleted";
      await db
        .insert(auditLog)
        .values({
          id: delivery.deliveryId,
          event: delivery.name,
          orderId: payload.id,
          detail,
        })
        .onConflictDoNothing();
    },
  });

  const receipt = defineListener<Created>({
    name: "receipt",
    on: "order.create",
    run: async ({ deliveryId, payload }) => {
      await db
        .insert(notifications)
        .values({
          id: deliveryId,
          kind: "receipt",
          orderId: payload.id,
          recipient: payload.row.customer,
        })
        .onConflictDoNothing();
    },
  });

  const fulfilment = defineListener({
    name: "fulfilment",
    on: events.shipped,
    workflow: fulfilOrder,
  });

  // The payload is typed from the catalog: { id: string; customer: string }.
  const shipping = defineListener({
    name: "shipping",
    on: events.shipped,
    maxAttempts: 3,
    run: async ({ deliveryId, payload }) => {
      await carrier.book(payload.id);
      await db
        .insert(notifications)
        .values({
          id: deliveryId,
          kind: "shipped",
          orderId: payload.id,
          recipient: payload.customer,
        })
        .onConflictDoNothing();
    },
  });

  return [audit, receipt, options.workflows ? fulfilment : shipping];
}
