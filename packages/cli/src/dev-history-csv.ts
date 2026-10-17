import type { HistoryTrace } from "./dev-history";

// Kept apart from dev-history so the dashboard can export what it shows without
// pulling in the database code.

const CSV_COLUMNS = [
  "time",
  "method",
  "route",
  "path",
  "status",
  "outcome",
  "duration_ms",
  "service",
  "action",
  "message",
  "trace_id",
] as const;

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  const text = String(value);
  // Quote anything a spreadsheet could split on, and defuse formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Requests as CSV with a header row, for the dashboard's export. */
export function tracesToCsv(traces: HistoryTrace[]): string {
  const lines = traces.map((trace) => {
    const failed = trace.status === "error" || (trace.httpStatus ?? 0) >= 500;
    const client = (trace.httpStatus ?? 0) >= 400;
    return [
      new Date(trace.startMs).toISOString(),
      trace.method,
      trace.route,
      trace.path,
      trace.httpStatus ?? trace.status,
      failed ? "server" : client ? "client" : "ok",
      trace.durationMs === undefined ? undefined : trace.durationMs.toFixed(3),
      trace.service,
      trace.action,
      trace.message,
      trace.traceId,
    ]
      .map(csvCell)
      .join(",");
  });
  return [CSV_COLUMNS.join(","), ...lines].join("\n") + "\n";
}
