import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tracesToCsv } from "./dev-history-csv";
import type { SpanOutcome, TraceSummary } from "./dev-telemetry-store";

export { tracesToCsv };

export const DEFAULT_HISTORY_DAYS = 90;

const DAY_MS = 86_400_000;
const MAX_TRACES = 100_000;
const FLUSH_MS = 250;
const PRUNE_MS = 30 * 60_000;
const VOLUME_BUCKETS = 48;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_FACET_VALUES = 30;
const MAX_EXPORT_ROWS = 100_000;

/** A finished request without its spans; fetch the full trace by id. */
export interface HistoryTrace {
  traceId: string;
  name: string;
  /** "GET /api/page/:id" when the method and route are known, else the span name. */
  endpoint: string;
  method?: string;
  route?: string;
  path?: string;
  httpStatus?: number;
  generation: number;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  status: SpanOutcome;
  truncated: boolean;
  /** The service and action that handled the request, when it ran one. */
  service?: string;
  action?: string;
  /** Why it failed, when it did. */
  message?: string;
}

/** How a request ended: a 5xx or crash, a 4xx, or neither. */
export type Outcome = "ok" | "client" | "server";
const OUTCOMES = new Set<string>(["ok", "client", "server"]);

/** A filter groups values with OR; separate filters combine with AND. */
export interface HistoryQuery {
  from: number;
  to: number;
  endpoints?: string[];
  methods?: string[];
  services?: string[];
  outcomes?: Outcome[];
  /** Only requests at least this slow. */
  minMs?: number;
  /** Matches the endpoint or the request path. */
  query?: string;
  sort?: "recent" | "slowest";
  limit?: number;
  offset?: number;
}

export interface VolumeBucket {
  start: number;
  ok: number;
  client: number;
  server: number;
}

/** The numbers behind the cards at the top of the log, for what matches. */
export interface HistorySummary {
  total: number;
  clientErrors: number;
  serverErrors: number;
  medianMs: number;
  p95Ms: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

/** What is in the range, counted for each filter as if it were not applied. */
export interface HistoryFacets {
  outcome: FacetValue[];
  method: FacetValue[];
  service: FacetValue[];
  endpoint: FacetValue[];
}

export interface HistoryInfo {
  days: number;
  count: number;
  oldestMs?: number;
}

interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

/**
 * SQLite from whichever runtime is running: `bun:sqlite` under Bun, and
 * `node:sqlite` under Node, which is what runs Vite's dev server. Both are
 * imported by a variable name so bundlers leave them alone.
 */
async function openDatabase(file: string): Promise<Database> {
  if (typeof Bun !== "undefined") {
    const specifier = "bun:sqlite";
    const { Database } = (await import(specifier)) as {
      Database: new (file: string, options: { create: boolean }) => Database;
    };
    return new Database(file, { create: true });
  }
  const specifier = "node:sqlite";
  // Node prints an experimental-feature warning when this module loads. It is
  // stable enough for a local log, and the warning would only confuse.
  const emit = process.emitWarning;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    if (typeof warning === "string" && warning.includes("SQLite")) return;
    return (emit as (...args: unknown[]) => void).call(
      process,
      warning,
      ...rest,
    );
  }) as typeof process.emitWarning;
  try {
    const { DatabaseSync } = (await import(specifier)) as {
      DatabaseSync: new (file: string) => Database;
    };
    return new DatabaseSync(file);
  } finally {
    process.emitWarning = emit;
  }
}

export interface OpenHistoryOptions {
  /** The project folder; the database lives in `.brick/` inside it. */
  directory: string;
  /** How long to keep requests. Zero or less turns history off. */
  days: number;
  warn?: (message: string) => void;
}

/**
 * Open the request history, or return undefined when it is turned off or this
 * runtime has no SQLite. Never throws: the dashboard works without history.
 */
export async function openHistory(
  options: OpenHistoryOptions,
): Promise<DevHistory | undefined> {
  if (!(options.days > 0)) return undefined;
  try {
    const folder = join(options.directory, ".brick");
    mkdirSync(folder, { recursive: true });
    // Requests can hold SQL text and error details, so never let them be
    // committed by accident.
    const ignore = join(folder, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
    const database = await openDatabase(join(folder, "telemetry.sqlite"));
    return new DevHistory(database, options.days);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    options.warn?.(
      `[Brick-TS] Request history is unavailable (${reason}). It needs Bun, or Node 22.5 or later. Continuing without it.`,
    );
    return undefined;
  }
}

const text = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : String(value);
const number = (value: unknown): number | undefined =>
  value === null || value === undefined ? undefined : Number(value);

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const OUTCOME_SQL: Record<Outcome, string> = {
  server: "(status = 'error' OR http_status >= 500)",
  client: "(status != 'error' AND http_status >= 400 AND http_status < 500)",
  ok: "(status != 'error' AND (http_status IS NULL OR http_status < 400))",
};

/** The outcome of each row, for counting; agrees with OUTCOME_SQL. */
const OUTCOME_CASE = `CASE
  WHEN status = 'error' OR http_status >= 500 THEN 'server'
  WHEN http_status >= 400 AND http_status < 500 THEN 'client'
  ELSE 'ok' END`;

type Facet = "outcome" | "method" | "service" | "endpoint";

const FACET_COLUMNS: Record<Facet, string> = {
  outcome: OUTCOME_CASE,
  method: "method",
  service: "service",
  endpoint: "endpoint",
};

/** The WHERE clause for a query, leaving out one filter when counting its facet. */
function filterSql(
  query: HistoryQuery,
  skip?: Facet,
): { sql: string; params: unknown[] } {
  const clauses = ["start_ms >= ?", "start_ms <= ?"];
  const params: unknown[] = [query.from, query.to];
  const anyOf = (column: string, values: string[] | undefined) => {
    if (!values || values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  };
  if (skip !== "endpoint") anyOf("endpoint", query.endpoints);
  if (skip !== "method") anyOf("method", query.methods);
  if (skip !== "service") anyOf("service", query.services);
  if (skip !== "outcome" && query.outcomes && query.outcomes.length > 0) {
    clauses.push(
      `(${query.outcomes.map((outcome) => OUTCOME_SQL[outcome]).join(" OR ")})`,
    );
  }
  if (query.minMs !== undefined && query.minMs > 0) {
    clauses.push("duration_ms >= ?");
    params.push(query.minMs);
  }
  const needle = query.query?.trim();
  if (needle) {
    const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      "(endpoint LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')",
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: clauses.join(" AND "), params };
}

const LIST_COLUMNS = `trace_id, name, endpoint, method, route, path, http_status, generation,
  start_ms, end_ms, duration_ms, status, truncated, service, action, message`;

function toHistoryTrace(row: Record<string, unknown>): HistoryTrace {
  return {
    traceId: String(row.trace_id),
    name: String(row.name),
    endpoint: String(row.endpoint),
    method: text(row.method),
    route: text(row.route),
    path: text(row.path),
    httpStatus: number(row.http_status),
    generation: Number(row.generation),
    startMs: Number(row.start_ms),
    endMs: number(row.end_ms),
    durationMs: number(row.duration_ms),
    status: String(row.status) as SpanOutcome,
    truncated: Number(row.truncated) === 1,
    service: text(row.service),
    action: text(row.action),
    message: text(row.message),
  };
}

/**
 * Requests kept on disk between runs, for looking back over weeks
 * instead of the last few minutes. Writes are batched; reads see them.
 */
export class DevHistory {
  readonly days: number;
  readonly #database: Database;
  readonly #pendingTraces = new Map<string, TraceSummary>();
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #pruneTimer: ReturnType<typeof setInterval>;
  #closed = false;

  constructor(database: Database, days: number) {
    this.#database = database;
    this.days = days;
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS traces (
        trace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT,
        route TEXT,
        path TEXT,
        http_status INTEGER,
        generation INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER,
        duration_ms REAL,
        status TEXT NOT NULL,
        truncated INTEGER NOT NULL,
        spans TEXT NOT NULL,
        service TEXT,
        action TEXT,
        message TEXT
      );
      CREATE INDEX IF NOT EXISTS traces_start ON traces (start_ms);
      CREATE INDEX IF NOT EXISTS traces_endpoint ON traces (endpoint, start_ms);
      -- Earlier versions kept failures here; nothing reads them now.
      DROP TABLE IF EXISTS failures;
    `);
    this.#addMissingColumns();
    this.prune();
    this.#pruneTimer = setInterval(() => this.prune(), PRUNE_MS);
    this.#pruneTimer.unref?.();
  }

  /** A folder from an earlier version has the table without the newer columns. */
  #addMissingColumns(): void {
    const present = new Set(
      this.#database
        .prepare("PRAGMA table_info(traces)")
        .all()
        .map((column) => String(column.name)),
    );
    for (const column of ["service", "action", "message"]) {
      if (!present.has(column)) {
        this.#database.exec(`ALTER TABLE traces ADD COLUMN ${column} TEXT`);
      }
    }
  }

  /** Queue a finished request. A later save of the same request replaces it. */
  saveTrace(trace: TraceSummary): void {
    if (this.#closed) return;
    this.#pendingTraces.set(trace.traceId, trace);
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
    this.#flushTimer.unref?.();
  }

  /** Write queued requests now. */
  flush(): void {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    if (this.#closed || this.#pendingTraces.size === 0) return;
    const traces = [...this.#pendingTraces.values()];
    this.#pendingTraces.clear();
    try {
      this.#database.exec("BEGIN");
      const saveTrace = this.#database.prepare(
        `INSERT OR REPLACE INTO traces (trace_id, name, endpoint, method, route, path,
          http_status, generation, start_ms, end_ms, duration_ms, status, truncated, spans,
          service, action, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const trace of traces) {
        saveTrace.run(
          trace.traceId,
          trace.name,
          trace.method && trace.route
            ? `${trace.method} ${trace.route}`
            : trace.name,
          trace.method ?? null,
          trace.route ?? null,
          trace.path ?? null,
          trace.httpStatus ?? null,
          trace.generation,
          trace.startMs,
          trace.endMs ?? null,
          trace.durationMs ?? null,
          trace.status,
          trace.truncated ? 1 : 0,
          JSON.stringify(trace.spans),
          trace.service ?? null,
          trace.action ?? null,
          trace.message ?? null,
        );
      }
      this.#database.exec("COMMIT");
    } catch {
      // A failed write loses a batch of history; it must not break the app.
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Nothing was open.
      }
    }
  }

  /** Drop what is past retention, then the oldest beyond the size cap. */
  prune(now = Date.now()): void {
    if (this.#closed) return;
    try {
      const cutoff = now - this.days * DAY_MS;
      this.#database
        .prepare("DELETE FROM traces WHERE start_ms < ?")
        .run(cutoff);
      const count = Number(
        this.#database.prepare("SELECT COUNT(*) AS n FROM traces").get()?.n ??
          0,
      );
      if (count > MAX_TRACES) {
        this.#database
          .prepare(
            "DELETE FROM traces WHERE trace_id IN (SELECT trace_id FROM traces ORDER BY start_ms ASC LIMIT ?)",
          )
          .run(count - MAX_TRACES);
      }
    } catch {
      // Pruning is housekeeping; try again next time.
    }
  }

  info(): HistoryInfo {
    this.flush();
    const row = this.#database
      .prepare("SELECT COUNT(*) AS n, MIN(start_ms) AS oldest FROM traces")
      .get();
    return {
      days: this.days,
      count: Number(row?.n ?? 0),
      oldestMs: number(row?.oldest),
    };
  }

  /** Matching requests, without spans, and how many match in total. */
  traces(query: HistoryQuery): { total: number; traces: HistoryTrace[] } {
    this.flush();
    const { sql, params } = filterSql(query);
    const total = Number(
      this.#database
        .prepare(`SELECT COUNT(*) AS n FROM traces WHERE ${sql}`)
        .get(...params)?.n ?? 0,
    );
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const offset = Math.max(query.offset ?? 0, 0);
    const order =
      query.sort === "slowest"
        ? "duration_ms DESC, start_ms DESC"
        : "start_ms DESC";
    const rows = this.#database
      .prepare(
        `SELECT ${LIST_COLUMNS}
         FROM traces WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return { total, traces: rows.map(toHistoryTrace) };
  }

  /** Counts for each filter over the range, ignoring that filter's own choice. */
  facets(query: HistoryQuery): HistoryFacets {
    this.flush();
    const count = (facet: Facet): FacetValue[] => {
      const { sql, params } = filterSql(query, facet);
      const column = FACET_COLUMNS[facet];
      return this.#database
        .prepare(
          `SELECT ${column} AS value, COUNT(*) AS n FROM traces
           WHERE ${sql} AND ${column} IS NOT NULL
           GROUP BY value ORDER BY n DESC, value ASC LIMIT ?`,
        )
        .all(...params, MAX_FACET_VALUES)
        .map((row) => ({ value: String(row.value), count: Number(row.n) }));
    };
    return {
      outcome: count("outcome"),
      method: count("method"),
      service: count("service"),
      endpoint: count("endpoint"),
    };
  }

  /** Matching requests per time bucket across the range, by outcome. */
  volume(query: HistoryQuery, buckets = VOLUME_BUCKETS): VolumeBucket[] {
    this.flush();
    const { sql, params } = filterSql(query);
    const bucketMs = Math.max(Math.ceil((query.to - query.from) / buckets), 1);
    const result: VolumeBucket[] = Array.from(
      { length: buckets },
      (_, index) => ({
        start: query.from + index * bucketMs,
        ok: 0,
        client: 0,
        server: 0,
      }),
    );
    const rows = this.#database
      .prepare(
        `SELECT CAST((start_ms - ?) / ? AS INTEGER) AS bucket, ${OUTCOME_CASE} AS outcome,
           COUNT(*) AS n
         FROM traces WHERE ${sql} GROUP BY bucket, outcome`,
      )
      .all(query.from, bucketMs, ...params);
    for (const row of rows) {
      const bucket =
        result[Math.min(Math.max(Number(row.bucket), 0), buckets - 1)];
      const outcome = String(row.outcome) as Outcome;
      if (bucket) bucket[outcome] += Number(row.n);
    }
    return result;
  }

  /** Every matching request, newest first, as CSV for a spreadsheet. */
  exportCsv(query: HistoryQuery): string {
    this.flush();
    const { sql, params } = filterSql(query);
    const order =
      query.sort === "slowest"
        ? "duration_ms DESC, start_ms DESC"
        : "start_ms DESC";
    const rows = this.#database
      .prepare(
        `SELECT ${LIST_COLUMNS}
         FROM traces WHERE ${sql} ORDER BY ${order} LIMIT ?`,
      )
      .all(...params, MAX_EXPORT_ROWS);
    return tracesToCsv(rows.map(toHistoryTrace));
  }

  /** One request with all its spans. */
  trace(traceId: string): TraceSummary | undefined {
    this.flush();
    const row = this.#database
      .prepare(`SELECT ${LIST_COLUMNS}, spans FROM traces WHERE trace_id = ?`)
      .get(traceId);
    if (!row) return undefined;
    const { endpoint: _endpoint, ...trace } = toHistoryTrace(row);
    return { ...trace, spans: JSON.parse(String(row.spans)) };
  }

  /** How many requests match, how many failed, and how long they took. */
  summary(query: HistoryQuery): HistorySummary {
    this.flush();
    const { sql, params } = filterSql(query);
    let total = 0;
    let clientErrors = 0;
    let serverErrors = 0;
    const counts = this.#database
      .prepare(
        `SELECT ${OUTCOME_CASE} AS outcome, COUNT(*) AS n
         FROM traces WHERE ${sql} GROUP BY outcome`,
      )
      .all(...params);
    for (const row of counts) {
      const n = Number(row.n);
      total += n;
      if (row.outcome === "client") clientErrors = n;
      if (row.outcome === "server") serverErrors = n;
    }
    const durations = this.#database
      .prepare(
        `SELECT duration_ms FROM traces
         WHERE ${sql} AND duration_ms IS NOT NULL ORDER BY duration_ms`,
      )
      .all(...params)
      .map((row) => Number(row.duration_ms));
    return {
      total,
      clientErrors,
      serverErrors,
      medianMs: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
    };
  }

  /** Write what is queued and release the database. */
  close(): void {
    if (this.#closed) return;
    this.flush();
    this.#closed = true;
    clearInterval(this.#pruneTimer);
    try {
      this.#database.close();
    } catch {
      // Already closed.
    }
  }
}

/** Query-string values the dashboard sends, parsed defensively. */
export function parseHistoryQuery(
  params: URLSearchParams,
  now = Date.now(),
): HistoryQuery {
  const integer = (name: string): number | undefined => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const all = (name: string): string[] | undefined => {
    const values = params.getAll(name).filter((value) => value !== "");
    return values.length > 0 ? values : undefined;
  };
  const to = integer("to") ?? now;
  return {
    to,
    from: integer("from") ?? to - 7 * DAY_MS,
    endpoints: all("endpoint"),
    methods: all("method"),
    services: all("service"),
    outcomes: all("outcome")?.filter((value): value is Outcome =>
      OUTCOMES.has(value),
    ),
    minMs: integer("minMs"),
    query: params.get("q") || undefined,
    sort: params.get("sort") === "slowest" ? "slowest" : "recent",
    limit: integer("limit"),
    offset: integer("offset"),
  };
}
