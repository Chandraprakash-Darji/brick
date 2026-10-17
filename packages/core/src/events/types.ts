/**
 * An event, as it was recorded. It is the same for every listener of it.
 */
export interface EventEnvelope<TPayload = unknown> {
  /** Unique per event. Every listener's delivery of the event shares it. */
  id: string;
  /** The event name, such as `user.create`. */
  name: string;
  /** What happened. JSON data. */
  payload: TPayload;
  /** When it happened, as an ISO timestamp. */
  occurredAt: string;
  /** The trace of the request that caused it, so a listener continues the same trace. */
  traceId?: string;
  /** What emitted it, such as `identity.user` for a generated CRUD write. */
  source?: string;
}

/**
 * One listener's delivery of an event: the envelope, plus which listener it is for
 * and which attempt this is.
 */
export interface EventDelivery<
  TPayload = unknown,
> extends EventEnvelope<TPayload> {
  /** The name of the listener this delivery is for. */
  listener: string;
  /**
   * `<event id>:<listener>`. It is the same on every retry, so a listener can use
   * it to avoid doing the work twice: delivery is at least once.
   */
  deliveryId: string;
  /** 1 on the first try, 2 on the first retry, and so on. */
  attempt: number;
}

/**
 * The CRUD events of a resource called `user`, by operation. Listeners of
 * `user.create`, `user.update` and `user.delete` receive these payloads.
 */
export type CrudEventPayload<TRow = Record<string, unknown>> =
  | { id: unknown; row: TRow }
  | { id: unknown; before: TRow; after: TRow };

/**
 * A listener: code that runs when an event it listens for has been recorded.
 */
export interface EventListener<TPayload = any> {
  /** Unique among the app's listeners. It is part of each delivery's id. */
  readonly name: string;
  /**
   * The event names to listen for. A trailing `*` matches a prefix (`user.*`),
   * and `*` alone matches every event.
   */
  readonly on: readonly string[];
  /** Runs for each delivery. Throwing retries the delivery with a growing delay. */
  readonly run: (delivery: EventDelivery<TPayload>) => void | Promise<void>;
  /** Attempts before the delivery is parked as dead. Defaults to the dispatcher's. */
  readonly maxAttempts?: number;
}

/**
 * How the dispatcher delivers recorded events.
 */
export interface DispatchOptions {
  /**
   * Whether to look for due deliveries on a timer, and right after a commit.
   * Default `true`. With `false`, deliveries run only when something calls
   * `app.events.drain()`: a cron job, a worker you drive yourself, or a test.
   */
  timer?: boolean;
  /** How often to look for deliveries that are due, in milliseconds. Default 1000. */
  intervalMs?: number;
  /** Most deliveries claimed at once. Default 50. */
  batchSize?: number;
  /** Attempts before a delivery is parked as dead. Default 8. */
  maxAttempts?: number;
  /** How long a claimed delivery may run before another dispatcher takes it, in milliseconds. Default 60000. */
  claimTimeoutMs?: number;
  /** Longest wait before a retry, in milliseconds. Default 300000. */
  maxBackoffMs?: number;
  /** How long delivered rows are kept, in milliseconds. Default 86400000 (one day). 0 keeps none. */
  retainDeliveredMs?: number;
}

/**
 * The `events` option of `brick()`.
 */
export interface EventsOptions {
  /** The listeners of the app. */
  listeners?: readonly EventListener[];
  /**
   * Whether this process delivers recorded events. `true` (the default) starts a
   * dispatcher with the default settings, an object tunes it, and `false` only
   * records events, for an app whose events are delivered by another process.
   */
  dispatch?: boolean | DispatchOptions;
}

/**
 * Records an event inside the transaction it was given. The event is committed
 * with the write, or not at all.
 */
export type EventRecorder = (name: string, payload: unknown) => Promise<void>;

/**
 * What a service with events offers the code that writes to its database. A
 * service has it once `brick({ events })` is set up and its database holds an
 * outbox table.
 */
export interface ServiceEvents {
  /** Whether any listener wants the event, so a write can skip recording one. */
  wants(name: string): boolean;
  /**
   * Run `fn` in a database transaction. Events it records are committed with
   * whatever else it wrote, or not at all, and are delivered after the commit.
   */
  transaction<T>(
    db: unknown,
    context: { traceId?: string; source?: string },
    fn: (tx: any, record: EventRecorder) => Promise<T>,
  ): Promise<T>;
}
