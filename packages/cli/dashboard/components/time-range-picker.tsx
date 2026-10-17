import { useState, type FormEvent } from "react";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateTime } from "@/format";
import type { Window } from "@/history";
import {
  PRESETS,
  presetWindow,
  toInputValue,
  windowFromInputs,
} from "@/time-range";

const HOUR = 3_600_000;

/**
 * Choose the time the request list covers by naming its start and end, for
 * when the ranges beside it are too coarse and dragging across the timeline is
 * too loose. It sets the same window a drag does.
 */
export function TimeRangePicker({
  value,
  historyDays,
  onApply,
  onClear,
}: {
  /** The window chosen now, by this or by dragging on the timeline. */
  value: Window | undefined;
  historyDays: number;
  onApply: (window: Window) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const checked = windowFromInputs(from, to);
  const problem = "problem" in checked ? checked.problem : undefined;

  // Each time it opens, it starts from the window in use, or the last hour.
  const show = (next: boolean) => {
    if (next) {
      const now = Date.now();
      const start = value ?? { from: now - HOUR, to: now };
      setFrom(toInputValue(start.from));
      setTo(toInputValue(start.to));
    }
    setOpen(next);
  };
  const choose = (preset: (typeof PRESETS)[number]["value"]) => {
    const picked = presetWindow(preset, Date.now());
    setFrom(toInputValue(picked.from));
    setTo(toInputValue(picked.to));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if ("window" in checked) {
      onApply(checked.window);
      setOpen(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={show}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              aria-label="Choose a time range"
              className="tabular-nums"
            />
          }
        >
          <CalendarRange />
          {value
            ? `${formatDateTime(value.from)} – ${formatDateTime(value.to)}`
            : "Custom"}
        </PopoverTrigger>
        <PopoverContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <label className="flex flex-col gap-1 text-xs font-medium">
              From
              <Input
                type="datetime-local"
                step={1}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              To
              <Input
                type="datetime-local"
                step={1}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => choose(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            {problem ? (
              <p role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Times are in your time zone. History keeps {historyDays}{" "}
                {historyDays === 1 ? "day" : "days"}.
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={problem !== undefined}>
                Apply
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Clear time range"
          onClick={onClear}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
