import type { EventDelivery, EventListener } from "./types";

/**
 * Define a listener: code that runs for each event it listens for, after the write
 * that caused the event has been committed. Pass it to `brick({ events: {
 * listeners } })`.
 *
 * Delivery is at least once. A listener that throws is retried later with a
 * growing delay, then parked as dead, so it can run again for the same event:
 * use `delivery.deliveryId` to make its work idempotent.
 *
 * @param config - `name` (unique; it is part of each delivery's id), `on` (an
 * event name or a list of them; a trailing `*` matches a prefix, as in
 * `user.*`), `run`, and optionally `maxAttempts`.
 * @returns The listener.
 * @throws When the name is empty or contains `:`, or `on` is empty.
 * @example
 * import { brick, defineListener } from "@brickkit/core";
 *
 * const welcome = defineListener({
 *   name: "welcome-email",
 *   on: "user.create",
 *   run: async ({ payload, deliveryId }) => {
 *     await mailer.sendWelcome(payload.row.email, { idempotencyKey: deliveryId });
 *   },
 * });
 *
 * export default brick({ services, events: { listeners: [welcome] } });
 */
export function defineListener<TPayload = any>(config: {
  name: string;
  on: string | readonly string[];
  run: (delivery: EventDelivery<TPayload>) => void | Promise<void>;
  maxAttempts?: number;
}): EventListener<TPayload> {
  if (typeof config.name !== "string" || !config.name)
    throw new Error("An event listener needs a name");
  if (config.name.includes(":"))
    throw new Error(
      `Event listener name '${config.name}' must not contain ':'`,
    );
  const on = typeof config.on === "string" ? [config.on] : [...config.on];
  if (!on.length || on.some((pattern) => !pattern))
    throw new Error(`Event listener '${config.name}' listens for nothing`);
  if (
    config.maxAttempts !== undefined &&
    (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1)
  )
    throw new Error(
      `Event listener '${config.name}': maxAttempts must be a positive integer`,
    );
  return Object.freeze({
    name: config.name,
    on: Object.freeze(on),
    run: config.run,
    ...(config.maxAttempts !== undefined
      ? { maxAttempts: config.maxAttempts }
      : {}),
  });
}
