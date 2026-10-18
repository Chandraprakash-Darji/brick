import type { Carrier } from "./carrier";

/**
 * What the steps of a workflow reach for. A step is a plain function the
 * Workflow SDK calls by name, so it cannot close over the app that started it.
 */
export interface OrdersContext {
  db: any;
  carrier: Carrier;
}

let current: OrdersContext | undefined;

export function setOrdersContext(context: OrdersContext) {
  current = context;
}

export function ordersContext(): OrdersContext {
  if (!current) throw new Error("The orders app has not been created");
  return current;
}
