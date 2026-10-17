import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { type OutboxStatus, type OutboxTable, outboxEngine } from "./outbox";
import { runInTransaction } from "./transaction";
import type { DispatchOptions, EventDelivery, EventListener } from "./types";

export type ResolvedDispatchOptions = Required<DispatchOptions>;

export function resolveDispatchOptions(
  options: DispatchOptions = {},
): ResolvedDispatchOptions {
  return {
    timer: options.timer ?? true,
    intervalMs: options.intervalMs ?? 1_000,
    batchSize: options.batchSize ?? 50,
    maxAttempts: options.maxAttempts ?? 8,
    claimTimeoutMs: options.claimTimeoutMs ?? 60_000,
    maxBackoffMs: options.maxBackoffMs ?? 300_000,
    retainDeliveredMs: options.retainDeliveredMs ?? 86_400_000,
  };
}

/** How many outbox rows are in each state. */
export type OutboxCounts = Record<OutboxStatus, number>;

interface OutboxRow {
  seq: number;
  id: string;
  eventId: string;
  listener: string;
  name: string;
  payload: unknown;
  traceId: string | null;
  source: string | null;
  occurredAt: Date;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
}

const PURGE_INTERVAL_MS = 60_000;

export function backoffMs(attempt: number, maxBackoffMs: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), maxBackoffMs);
}

/**
 * Delivers the events recorded in one outbox table to the app's listeners.
 *
 * It claims a batch of due rows, runs each listener, and marks the row delivered.
 * A listener that throws is retried later with a growing delay, and parked as
 * dead after its attempts run out. Several dispatchers can share a table: on
 * Postgres they claim with `FOR UPDATE SKIP LOCKED`, and a claim that is not
 * finished within `claimTimeoutMs` (the process died) is taken by another.
 * Delivery is at least once, so a listener should tolerate running twice for the
 * same `deliveryId`.
 */
export class Dispatcher {
  private readonly engine: "sqlite" | "postgres";
  private readonly options: ResolvedDispatchOptions;
  private readonly inFlight = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private tickQueue?: Promise<number>;
  private lastPurge = 0;

  constructor(
    private readonly db: any,
    private readonly table: OutboxTable,
    private readonly listeners: (name: string) => EventListener | undefined,
    options: DispatchOptions = {},
    private readonly onError: (error: unknown) => void = (error) =>
      console.error("[Brick-TS events]", error),
  ) {
    this.engine = outboxEngine(table);
    this.options = resolveDispatchOptions(options);
  }

  /** Whether the dispatcher is looking for work on a timer. */
  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Start looking for due deliveries on a timer. Does nothing if it already is. */
  start(): void {
    if (this.timer || !this.options.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  /**
   * Stop the timer and wait for the deliveries that are running to finish.
   */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.tickQueue;
    await Promise.allSettled(this.inFlight);
  }

  /** Look for work soon, without waiting for the timer. Safe to call often. */
  notify(): void {
    if (!this.timer) return;
    setTimeout(() => void this.tick(), 0).unref?.();
  }

  /**
   * Claim what is due and run it, once. Used by the timer, and by tests and
   * workers that drive delivery themselves.
   *
   * @returns How many deliveries it started.
   */
  tick(): Promise<number> {
    this.tickQueue = (this.tickQueue ?? Promise.resolve(0)).then(
      () => this.claimAndRun(),
      () => this.claimAndRun(),
    );
    return this.tickQueue;
  }

  /**
   * Deliver everything that is due now and wait until those deliveries are done.
   * Deliveries that fail and are rescheduled are not waited for again.
   *
   * @returns How many deliveries it ran.
   */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const started = await this.tick();
      await Promise.allSettled(this.inFlight);
      if (started === 0) return total;
      total += started;
    }
  }

  /**
   * How many rows are in each state.
   */
  async counts(): Promise<OutboxCounts> {
    const t = this.table as any;
    const rows: { status: OutboxStatus; count: number }[] = await this.db
      .select({ status: t.status, count: sql<number>`count(*)` })
      .from(t)
      .groupBy(t.status);
    const counts: OutboxCounts = {
      pending: 0,
      claimed: 0,
      delivered: 0,
      dead: 0,
    };
    for (const row of rows) counts[row.status] = Number(row.count);
    return counts;
  }

  /**
   * Put parked deliveries back in line, with their attempts reset.
   *
   * @param deliveryId - One delivery to retry. Omit it to retry every dead one.
   * @returns How many deliveries were put back.
   */
  async retryDead(deliveryId?: string): Promise<number> {
    const t = this.table as any;
    const rows: { id: string }[] = await this.db
      .update(t)
      .set({ status: "pending", attempts: 0, availableAt: new Date() })
      .where(
        deliveryId
          ? and(eq(t.status, "dead"), eq(t.id, deliveryId))
          : eq(t.status, "dead"),
      )
      .returning({ id: t.id });
    if (rows.length) this.notify();
    return rows.length;
  }

  private async claimAndRun(): Promise<number> {
    try {
      const room = this.options.batchSize - this.inFlight.size;
      if (room <= 0) return 0;
      const rows = await this.claim(room);
      for (const row of rows) {
        const run = this.deliver(row).finally(() => {
          this.inFlight.delete(run);
        });
        this.inFlight.add(run);
      }
      await this.purgeDelivered();
      return rows.length;
    } catch (error) {
      this.onError(error);
      return 0;
    }
  }

  private async claim(limit: number): Promise<OutboxRow[]> {
    const t = this.table as any;
    const now = new Date();
    const stale = new Date(now.getTime() - this.options.claimTimeoutMs);
    const due = or(
      and(eq(t.status, "pending"), lte(t.availableAt, now)),
      and(eq(t.status, "claimed"), lt(t.claimedAt, stale)),
    );
    const claimIn = async (tx: any): Promise<OutboxRow[]> => {
      let select = tx
        .select()
        .from(t)
        .where(due)
        .orderBy(asc(t.seq))
        .limit(limit);
      if (this.engine === "postgres")
        select = select.for("update", { skipLocked: true });
      const picked: OutboxRow[] = await select;
      if (!picked.length) return [];
      await tx
        .update(t)
        .set({
          status: "claimed",
          claimedAt: now,
          attempts: sql`${t.attempts} + 1`,
        })
        .where(
          inArray(
            t.seq,
            picked.map((row) => row.seq),
          ),
        );
      return picked.map((row) => ({ ...row, attempts: row.attempts + 1 }));
    };
    return this.engine === "postgres"
      ? this.db.transaction(claimIn)
      : runInTransaction(this.db, claimIn);
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const listener = this.listeners(row.listener);
    if (!listener) {
      await this.park(row, `No listener named '${row.listener}' is registered`);
      return;
    }
    const delivery: EventDelivery = {
      id: row.eventId,
      name: row.name,
      payload: row.payload,
      occurredAt: row.occurredAt.toISOString(),
      ...(row.traceId ? { traceId: row.traceId } : {}),
      ...(row.source ? { source: row.source } : {}),
      listener: row.listener,
      deliveryId: row.id,
      attempt: row.attempts,
    };
    try {
      await listener.run(delivery);
    } catch (error) {
      await this.fail(
        row,
        error,
        listener.maxAttempts ?? this.options.maxAttempts,
      );
      return;
    }
    await this.markDelivered(row);
  }

  private async markDelivered(row: OutboxRow): Promise<void> {
    const t = this.table as any;
    try {
      if (this.options.retainDeliveredMs === 0)
        await this.db.delete(t).where(eq(t.seq, row.seq));
      else
        await this.db
          .update(t)
          .set({
            status: "delivered",
            deliveredAt: new Date(),
            lastError: null,
          })
          .where(eq(t.seq, row.seq));
    } catch (error) {
      this.onError(error);
    }
  }

  private async fail(
    row: OutboxRow,
    error: unknown,
    maxAttempts: number,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (row.attempts >= maxAttempts) {
      await this.park(row, message);
      return;
    }
    const t = this.table as any;
    try {
      await this.db
        .update(t)
        .set({
          status: "pending",
          lastError: message,
          claimedAt: null,
          availableAt: new Date(
            Date.now() + backoffMs(row.attempts, this.options.maxBackoffMs),
          ),
        })
        .where(eq(t.seq, row.seq));
    } catch (writeError) {
      this.onError(writeError);
    }
  }

  private async park(row: OutboxRow, message: string): Promise<void> {
    const t = this.table as any;
    try {
      await this.db
        .update(t)
        .set({ status: "dead", lastError: message, claimedAt: null })
        .where(eq(t.seq, row.seq));
    } catch (error) {
      this.onError(error);
    }
  }

  private async purgeDelivered(): Promise<void> {
    const keep = this.options.retainDeliveredMs;
    const now = Date.now();
    if (keep === 0 || now - this.lastPurge < PURGE_INTERVAL_MS) return;
    this.lastPurge = now;
    const t = this.table as any;
    await this.db
      .delete(t)
      .where(
        and(eq(t.status, "delivered"), lt(t.deliveredAt, new Date(now - keep))),
      );
  }
}
