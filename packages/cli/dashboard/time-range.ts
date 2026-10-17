import type { Window } from "@/history";

const SECOND = 1000;
const pad = (value: number) => String(value).padStart(2, "0");

/** A time as a `datetime-local` input holds it: local time, to the second. */
export function toInputValue(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** The time a `datetime-local` input holds; undefined when it is blank or not a time. */
export function fromInputValue(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
    return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The window two inputs name, or what is wrong with them. The end is the end
 * of its second, so a request at 12:00:05.4 is inside "to 12:00:05".
 */
export function windowFromInputs(
  from: string,
  to: string,
): { window: Window } | { problem: string } {
  const start = fromInputValue(from);
  const end = fromInputValue(to);
  if (start === undefined || end === undefined)
    return { problem: "Choose both a start and an end." };
  if (start >= end) return { problem: "The start must be before the end." };
  return { window: { from: start, to: end + (SECOND - 1) } };
}

export type Preset = "15m" | "today" | "yesterday";

export const PRESETS: { value: Preset; label: string }[] = [
  { value: "15m", label: "Last 15 min" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
];

/** A named stretch of time, by the calendar of the machine showing it. */
export function presetWindow(preset: Preset, now: number): Window {
  if (preset === "15m") return { from: now - 15 * 60 * SECOND, to: now };
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (preset === "today") return { from: midnight.getTime(), to: now };
  const start = new Date(midnight);
  start.setDate(start.getDate() - 1);
  return { from: start.getTime(), to: midnight.getTime() - 1 };
}
