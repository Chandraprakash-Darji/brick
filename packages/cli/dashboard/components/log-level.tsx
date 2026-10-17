import { cn } from "@/lib/utils";
import type { LogLevel } from "@/logs";

const LEVEL_TEXT: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

/** A log line's level, in the color its severity calls for. */
export function LogLevelLabel({ level }: { level: LogLevel }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] font-semibold uppercase",
        LEVEL_TEXT[level],
      )}
    >
      {level}
    </span>
  );
}
