import type { ReactNode } from "react";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils";

/** Miniature stacked-block bar chart, with the newest column emphasized. */
export function SparkBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  return (
    <div aria-hidden className="flex h-18 shrink-0 items-end gap-1">
      {values.map((value, index) => {
        const blocks =
          max === 0 ? 1 : Math.max(1, Math.round((value / max) * 9));
        const last = index === values.length - 1;
        return (
          <span key={index} className="flex flex-col-reverse gap-px">
            {Array.from({ length: blocks }, (_, block) => (
              <span
                key={block}
                className={cn(
                  "h-1.5 w-1.25",
                  last ? "bg-foreground" : "bg-foreground/22",
                )}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}

export function Metric({
  icon,
  label,
  value,
  note,
  spark,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  /** A line under the value. */
  note?: string;
  /** Recent values for the miniature chart; omit for none. */
  spark?: number[];
}) {
  return (
    <Panel>
      <div className="flex justify-between gap-2 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs tracking-wide text-muted-foreground [&_svg]:size-3">
            {icon}
            {label}
          </div>
          <div className="mt-1 text-2xl font-medium tracking-tight tabular-nums">
            {value}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {note}
          </div>
        </div>
        {spark && <SparkBars values={spark} />}
      </div>
    </Panel>
  );
}
