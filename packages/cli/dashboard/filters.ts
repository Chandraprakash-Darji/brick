import { percentile } from "@/format";
import type {
  HistoryFacets,
  HistorySummary,
  HistoryTrace,
  Outcome,
  VolumeBucket,
} from "../src/dev-history";
import type { TraceSummary } from "../src/dev-telemetry-store";

export type { Outcome };

/** One line in the request log: a request without its spans. */
export type LogRow = HistoryTrace;

/** A filter groups its values with OR; separate filters combine with AND. */
export interface LogFilters {
  query: string;
  outcomes: Outcome[];
  methods: string[];
  services: string[];
  endpoints: string[];
  /** Only requests at least this slow, in milliseconds. */
  minMs?: number;
  sort: "recent" | "slowest";
}

export const NO_FILTERS: LogFilters = {
  query: "",
  outcomes: [],
  methods: [],
  services: [],
  endpoints: [],
  sort: "recent",
};

export function hasFilters(filters: LogFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.outcomes.length > 0 ||
    filters.methods.length > 0 ||
    filters.services.length > 0 ||
    filters.endpoints.length > 0 ||
    filters.minMs !== undefined
  );
}

/** A live request as a log row; the same shape the history API returns. */
export function toRow(trace: TraceSummary): LogRow {
  const { spans: _spans, ...row } = trace;
  return {
    ...row,
    endpoint:
      trace.method && trace.route
        ? `${trace.method} ${trace.route}`
        : trace.name,
  };
}

/** How a request ended: a 5xx or crash, a 4xx, or neither. */
export function outcomeOf(row: Pick<LogRow, "status" | "httpStatus">): Outcome {
  const http = row.httpStatus ?? 0;
  if (row.status === "error" || http >= 500) return "server";
  if (http >= 400) return "client";
  return "ok";
}

type Facet = "outcome" | "method" | "service" | "endpoint";

function matches(row: LogRow, filters: LogFilters, skip?: Facet): boolean {
  if (
    skip !== "endpoint" &&
    filters.endpoints.length > 0 &&
    !filters.endpoints.includes(row.endpoint)
  )
    return false;
  if (
    skip !== "method" &&
    filters.methods.length > 0 &&
    !(row.method && filters.methods.includes(row.method))
  )
    return false;
  if (
    skip !== "service" &&
    filters.services.length > 0 &&
    !(row.service && filters.services.includes(row.service))
  )
    return false;
  if (
    skip !== "outcome" &&
    filters.outcomes.length > 0 &&
    !filters.outcomes.includes(outcomeOf(row))
  )
    return false;
  if (filters.minMs !== undefined && (row.durationMs ?? 0) < filters.minMs)
    return false;
  const needle = filters.query.trim().toLowerCase();
  if (needle !== "") {
    const haystack = [row.endpoint, row.path, row.name, row.action, row.message]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export function applyFilters(rows: LogRow[], filters: LogFilters): LogRow[] {
  const kept = rows.filter((row) => matches(row, filters));
  return filters.sort === "slowest"
    ? kept.sort(
        (a, b) =>
          (b.durationMs ?? 0) - (a.durationMs ?? 0) || b.startMs - a.startMs,
      )
    : kept.sort((a, b) => b.startMs - a.startMs);
}

const MAX_FACET_VALUES = 30;

/** Counts for each filter, as if that filter were not applied. Matches the server. */
export function computeFacets(
  rows: LogRow[],
  filters: LogFilters,
): HistoryFacets {
  const count = (
    facet: Facet,
    pick: (row: LogRow) => string | undefined,
  ): HistoryFacets[Facet] => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!matches(row, filters, facet)) continue;
      const value = pick(row);
      if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, total]) => ({ value, count: total }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, MAX_FACET_VALUES);
  };
  return {
    outcome: count("outcome", outcomeOf),
    method: count("method", (row) => row.method),
    service: count("service", (row) => row.service),
    endpoint: count("endpoint", (row) => row.endpoint),
  };
}

/** Count rows into `count` equal time buckets across [from, to], by outcome. */
export function bucketRows(
  rows: LogRow[],
  from: number,
  to: number,
  count: number,
): VolumeBucket[] {
  const size = Math.max((to - from) / count, 1);
  const buckets: VolumeBucket[] = Array.from({ length: count }, (_, index) => ({
    start: from + index * size,
    ok: 0,
    client: 0,
    server: 0,
  }));
  for (const row of rows) {
    const index = Math.floor((row.startMs - from) / size);
    if (index < 0 || index > count) continue;
    buckets[Math.min(index, count - 1)][outcomeOf(row)] += 1;
  }
  return buckets;
}

const PAGE = 100;

/** The query string the history API takes for a window, filters, and page. */
export function historyParams(
  window: { from: number; to: number },
  filters: LogFilters,
  page?: { offset: number },
): URLSearchParams {
  const params = new URLSearchParams({
    from: String(window.from),
    to: String(window.to),
  });
  for (const endpoint of filters.endpoints) params.append("endpoint", endpoint);
  for (const method of filters.methods) params.append("method", method);
  for (const service of filters.services) params.append("service", service);
  for (const outcome of filters.outcomes) params.append("outcome", outcome);
  if (filters.minMs !== undefined) params.set("minMs", String(filters.minMs));
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.sort !== "recent") params.set("sort", filters.sort);
  if (page) {
    params.set("limit", String(PAGE));
    params.set("offset", String(page.offset));
  }
  return params;
}

/** The numbers for the cards at the top of the log, for these requests. */
export function summarizeRows(rows: LogRow[]): HistorySummary {
  let clientErrors = 0;
  let serverErrors = 0;
  const durations: number[] = [];
  for (const row of rows) {
    const outcome = outcomeOf(row);
    if (outcome === "client") clientErrors += 1;
    if (outcome === "server") serverErrors += 1;
    if (row.durationMs !== undefined) durations.push(row.durationMs);
  }
  durations.sort((a, b) => a - b);
  return {
    total: rows.length,
    clientErrors,
    serverErrors,
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  };
}

/** Volume folded into a few columns for a card's miniature chart, oldest first. */
export function sparkGroups(
  volume: VolumeBucket[] | undefined,
  groups = 8,
): { requests: number[]; errors: number[] } {
  const list = volume ?? [];
  const size = Math.ceil(list.length / groups) || 1;
  const fold = (pick: (bucket: VolumeBucket) => number) =>
    Array.from({ length: groups }, (_, group) =>
      list
        .slice(group * size, (group + 1) * size)
        .reduce((sum, bucket) => sum + pick(bucket), 0),
    );
  return {
    requests: fold((bucket) => bucket.ok + bucket.client + bucket.server),
    errors: fold((bucket) => bucket.client + bucket.server),
  };
}
