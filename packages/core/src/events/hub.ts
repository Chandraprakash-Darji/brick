import { Dispatcher, type OutboxCounts } from "./dispatcher";
import { newEventId } from "./id";
import type { OutboxTable } from "./outbox";
import { runInTransaction } from "./transaction";
import type {
  DispatchOptions,
  EventListener,
  EventRecorder,
  EventsOptions,
  ServiceEvents,
} from "./types";

interface EventsHost {
  readonly name: string;
  getDb(): unknown;
  getOutbox?(): OutboxTable | undefined;
  setEvents?(events: ServiceEvents | undefined): void;
}

export function matchesEvent(pattern: string, name: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

/**
 * What an app's `events` option describes, as plain data. It goes in the app
 * definition, which is sent to the dev dashboard, so it holds no functions.
 */
export interface EventsDefinition {
  listeners: { name: string; on: string[] }[];
  dispatch: boolean;
}

/**
 * The events of one app: who listens, where events are recorded, and the
 * dispatchers that deliver them. `brick({ events })` makes one and puts it on
 * `app.events`.
 */
export class EventsHub {
  private readonly byName = new Map<string, EventListener>();
  private readonly dispatchers = new Map<OutboxTable, Dispatcher>();
  private readonly dispatchOptions: DispatchOptions | false;
  private started = false;

  constructor(options: EventsOptions) {
    for (const listener of options.listeners ?? []) {
      if (typeof listener.name !== "string" || !listener.name)
        throw new Error("An event listener needs a name");
      if (listener.name.includes(":"))
        throw new Error(
          `Event listener name '${listener.name}' must not contain ':'`,
        );
      if (!listener.on?.length)
        throw new Error(
          `Event listener '${listener.name}' listens for nothing`,
        );
      if (this.byName.has(listener.name))
        throw new Error(`Duplicate event listener '${listener.name}'`);
      this.byName.set(listener.name, listener);
    }
    this.dispatchOptions =
      options.dispatch === false
        ? false
        : options.dispatch === true || options.dispatch === undefined
          ? {}
          : options.dispatch;
  }

  /**
   * Give each service whose database holds an outbox table a recorder, and a
   * dispatcher for that table. Call it before the first request: a service has no
   * recorder until then.
   *
   * @param services - The app's services.
   * @returns The hub, for chaining.
   */
  attach(services: readonly EventsHost[]): this {
    let attached = 0;
    for (const service of services) {
      const table = service.getOutbox?.();
      if (!table) continue;
      attached++;
      service.setEvents?.(this.bind(table));
    }
    if (attached === 0 && this.byName.size > 0) {
      console.warn(
        "[Brick-TS] events are configured, but no service database has an outbox table. " +
          "Add outboxTable() to a database's tables so its writes can record events.",
      );
    }
    for (const service of services) {
      const table = service.getOutbox?.();
      if (table && !this.dispatchers.has(table)) {
        this.dispatchers.set(
          table,
          new Dispatcher(
            service.getDb(),
            table,
            (name) => this.byName.get(name),
            this.dispatchOptions || {},
          ),
        );
      }
    }
    return this;
  }

  /** The listeners that want an event. */
  matching(name: string): EventListener[] {
    const found: EventListener[] = [];
    for (const listener of this.byName.values())
      if (listener.on.some((pattern) => matchesEvent(pattern, name)))
        found.push(listener);
    return found;
  }

  /** The listeners and settings, as plain data. */
  describe(): EventsDefinition {
    return {
      listeners: [...this.byName.values()].map((listener) => ({
        name: listener.name,
        on: [...listener.on],
      })),
      dispatch: this.dispatchOptions !== false,
    };
  }

  /**
   * Start delivering recorded events from this process. Does nothing if this
   * process only records events (`dispatch: false`) or already started.
   */
  start(): void {
    if (this.dispatchOptions === false || this.started) return;
    this.started = true;
    for (const dispatcher of this.dispatchers.values()) dispatcher.start();
  }

  /** Stop delivering, and wait for the deliveries that are running. */
  async stop(): Promise<void> {
    this.started = false;
    await Promise.all(
      [...this.dispatchers.values()].map((dispatcher) => dispatcher.stop()),
    );
  }

  /**
   * Deliver everything that is due now and wait for it. For tests and for
   * workers that drive delivery themselves.
   *
   * @returns How many deliveries ran.
   */
  async drain(): Promise<number> {
    let total = 0;
    for (const dispatcher of this.dispatchers.values())
      total += await dispatcher.drain();
    return total;
  }

  /** How many rows are in each state, across the app's outbox tables. */
  async counts(): Promise<OutboxCounts> {
    const total: OutboxCounts = {
      pending: 0,
      claimed: 0,
      delivered: 0,
      dead: 0,
    };
    for (const dispatcher of this.dispatchers.values()) {
      const counts = await dispatcher.counts();
      for (const status of Object.keys(total) as (keyof OutboxCounts)[])
        total[status] += counts[status];
    }
    return total;
  }

  /**
   * Put parked deliveries back in line.
   *
   * @param deliveryId - One delivery. Omit it to retry every dead one.
   * @returns How many deliveries were put back.
   */
  async retryDead(deliveryId?: string): Promise<number> {
    let total = 0;
    for (const dispatcher of this.dispatchers.values())
      total += await dispatcher.retryDead(deliveryId);
    return total;
  }

  private bind(table: OutboxTable): ServiceEvents {
    const startAndNotify = () => {
      this.start();
      this.dispatchers.get(table)?.notify();
    };
    return {
      wants: (name) => this.matching(name).length > 0,
      transaction: async (db, context, fn) => {
        let recorded = false;
        const result = await runInTransaction(db, async (tx) => {
          const record: EventRecorder = async (name, payload) => {
            const listeners = this.matching(name);
            if (!listeners.length) return;
            const eventId = newEventId();
            const occurredAt = new Date();
            await tx.insert(table as any).values(
              listeners.map((listener) => ({
                id: `${eventId}:${listener.name}`,
                eventId,
                listener: listener.name,
                name,
                payload,
                traceId: context.traceId ?? null,
                source: context.source ?? null,
                occurredAt,
                status: "pending",
                attempts: 0,
                availableAt: occurredAt,
              })),
            );
            recorded = true;
          };
          return fn(tx, record);
        });
        if (recorded) startAndNotify();
        return result;
      },
    };
  }
}
