import type { TraceSpan, TraceSummary } from "../src/dev-telemetry-store";

/** Client and server errors both count as failures, matching the Errors view. */
export function isFailure(
  trace: Pick<TraceSummary, "status" | "httpStatus">,
): boolean {
  return trace.status === "error" || (trace.httpStatus ?? 0) >= 400;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "running";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1).replace(/\.0$/, "")} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Clock time to the hundredth of a second, with the date for older requests. */
export function formatTimestamp(ms: number, withDate: boolean): string {
  const date = new Date(ms);
  const hundredths = String(date.getMilliseconds())
    .padStart(3, "0")
    .slice(0, 2);
  const time = `${date.toLocaleTimeString([], { hour12: false })}.${hundredths}`;
  return withDate
    ? `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
    : time;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

/** Month and day with the time, for requests that are days or weeks old. */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** A chart axis label: the time within a day or two, the date beyond that. */
export function formatAxis(ms: number, spanMs: number): string {
  return spanMs <= 36 * 3_600_000
    ? new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function formatCount(value: number): string {
  return value >= 10_000
    ? `${(value / 1000).toFixed(1)}K`
    : value.toLocaleString();
}

/** Linear-interpolated percentile of an ascending list; 0 for an empty list. */
export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export interface Bucket {
  start: number;
  ok: number;
  client: number;
  server: number;
}

/** Count traces into `count` equal buckets ending at `end`, oldest first. */
export function bucketize(
  traces: TraceSummary[],
  windowMs: number,
  count: number,
  end: number,
): Bucket[] {
  const size = windowMs / count;
  const start = end - windowMs;
  const buckets: Bucket[] = Array.from({ length: count }, (_, index) => ({
    start: start + index * size,
    ok: 0,
    client: 0,
    server: 0,
  }));
  for (const trace of traces) {
    const index = Math.floor((trace.startMs - start) / size);
    if (index < 0 || index >= count) continue;
    const bucket = buckets[index];
    if (trace.status === "error") bucket.server += 1;
    else if ((trace.httpStatus ?? 0) >= 400) bucket.client += 1;
    else bucket.ok += 1;
  }
  return buckets;
}

export type SpanKind = "http" | "action" | "rpc" | "sql" | "other";

export function spanKind(span: TraceSpan): SpanKind {
  if (span.attributes["db.statement"] !== undefined) return "sql";
  if (span.name.startsWith("action ")) return "action";
  if (span.name.startsWith("rpc ")) return "rpc";
  if (span.attributes["http.route"] !== undefined) return "http";
  return "other";
}

/** Depth of each span in its trace, from parent links. */
export function spanDepths(spans: TraceSpan[]): Map<string, number> {
  const parents = new Map(
    spans.map((span) => [span.spanId, span.parentSpanId]),
  );
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const parent = parents.get(id);
    const depth =
      parent !== undefined && parents.has(parent) ? depthOf(parent) + 1 : 0;
    depths.set(id, depth);
    return depth;
  };
  for (const span of spans) depthOf(span.spanId);
  return depths;
}

export interface TraceBreakdown {
  /** The action span that handled the request. */
  action: TraceSpan | undefined;
  /** Calls to other services made while handling it. */
  calls: TraceSpan[];
  queries: { count: number; totalMs: number; slowestMs: number };
  /** The first exception recorded on a span, with where it came from. */
  exception:
    | { message?: string; stack?: string; code?: string; span: string }
    | undefined;
}

const spanMs = (span: TraceSpan): number =>
  span.endMs === undefined ? 0 : span.endMs - span.startMs;

const textAttribute = (
  attributes: TraceSpan["attributes"] | undefined,
  key: string,
): string | undefined => {
  const value = attributes?.[key];
  return typeof value === "string" ? value : undefined;
};

/** What a request did, picked out of its spans for the detail view. */
export function describeTrace(trace: TraceSummary): TraceBreakdown {
  const queries = trace.spans.filter((span) => spanKind(span) === "sql");
  const durations = queries.map(spanMs);
  let exception: TraceBreakdown["exception"];
  for (const span of trace.spans) {
    const event = span.events.find((item) => item.name === "exception");
    const code = textAttribute(span.attributes, "brick.error.code");
    if (!event && !code) continue;
    exception = {
      message:
        textAttribute(event?.attributes, "exception.message") ??
        span.statusMessage,
      stack: textAttribute(event?.attributes, "exception.stacktrace"),
      code,
      span: span.name,
    };
    break;
  }
  return {
    action: trace.spans.find((span) => spanKind(span) === "action"),
    calls: trace.spans.filter((span) => spanKind(span) === "rpc"),
    queries: {
      count: queries.length,
      totalMs: durations.reduce((sum, value) => sum + value, 0),
      slowestMs: Math.max(0, ...durations),
    },
    exception,
  };
}

/**
 * An OpenAPI document that sends its requests to the app. Without servers a
 * reference would call the dashboard's own address, and relative ones would
 * resolve against it; both are pointed at `appUrl` instead. Servers that name
 * another host are kept, though the dashboard only forwards to the app.
 */
export function withAppServer(
  document: Record<string, unknown>,
  appUrl: string | undefined,
): Record<string, unknown> {
  if (!appUrl) return document;
  const listed = Array.isArray(document.servers)
    ? (document.servers as { url?: unknown }[])
    : [];
  const servers = listed
    .filter((server) => typeof server?.url === "string")
    .map((server) => {
      const url = server.url as string;
      // Variables such as {region} are filled in by the reference itself.
      if (url.includes("{")) return server;
      return {
        ...server,
        url: new URL(url, `${appUrl}/`).href.replace(/\/$/, ""),
      };
    });
  return {
    ...document,
    servers:
      servers.length > 0
        ? servers
        : [{ url: appUrl, description: "Dev server" }],
  };
}
