import type { EventDelivery, EventListener, EventWorkflow } from "./types";

type ListenerConfig<TPayload> = {
  name: string;
  on: string | readonly string[];
  maxAttempts?: number;
} & (
  | {
      run: (delivery: EventDelivery<TPayload>) => void | Promise<void>;
      workflow?: never;
    }
  | { workflow: EventWorkflow<TPayload>; run?: never }
);

/**
 * Define a listener: code that runs for each event it listens for, after the write
 * that caused the event has been committed. Pass it to `brick({ events: {
 * listeners } })`.
 *
 * It either runs a handler (`run`) in the process that delivers events, or starts
 * a durable workflow (`workflow`) on the app's `events.world`. Delivery is at
 * least once. A handler that throws is retried later with a growing delay, then
 * parked as dead, so it can run again for the same event: use
 * `delivery.deliveryId` to make its work idempotent. A workflow needs no such
 * care: a delivery starts one run however often it is tried, and the workflow
 * retries its own steps.
 *
 * @param config - `name` (unique; it is part of each delivery's id), `on` (an
 * event name or a list of them; a trailing `*` matches a prefix, as in
 * `user.*`), `run` or `workflow`, and optionally `maxAttempts`.
 * @returns The listener.
 * @throws When the name is empty or contains `:`, `on` is empty, or the listener
 * has both or neither of `run` and `workflow`.
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
 * @example
 * // src/workflows/onboard.ts
 * export async function onboard(event: WorkflowEvent<CrudEventPayload>) {
 *   "use workflow";
 *   await sendWelcome(event.payload.row.email);
 * }
 *
 * defineListener({ name: "onboard", on: "user.create", workflow: onboard });
 */
export function defineListener<TPayload = any>(
  config: ListenerConfig<TPayload>,
): EventListener<TPayload> {
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
  const { name, run, workflow } = config as {
    name: string;
    run?: unknown;
    workflow?: unknown;
  };
  if (run !== undefined && workflow !== undefined)
    throw new Error(
      `Event listener '${name}' has both run and workflow; give it one`,
    );
  if (run === undefined && workflow === undefined)
    throw new Error(
      `Event listener '${name}' needs a run handler or a workflow`,
    );
  if (run !== undefined && typeof run !== "function")
    throw new Error(`Event listener '${name}': run must be a function`);
  if (workflow !== undefined && typeof workflow !== "function")
    throw new Error(
      `Event listener '${name}': workflow must be a function marked "use workflow"`,
    );
  return Object.freeze({
    name: config.name,
    on: Object.freeze(on),
    ...(config.run !== undefined ? { run: config.run } : {}),
    ...(config.workflow !== undefined ? { workflow: config.workflow } : {}),
    ...(config.maxAttempts !== undefined
      ? { maxAttempts: config.maxAttempts }
      : {}),
  });
}
