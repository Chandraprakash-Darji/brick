import type { ComponentProps, ReactNode } from "react";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CORNERS = {
  tl: "top-0 left-0 -translate-x-1/2 -translate-y-1/2",
  tr: "top-0 right-0 translate-x-1/2 -translate-y-1/2",
  bl: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
  br: "right-0 bottom-0 translate-x-1/2 translate-y-1/2",
} as const;

/**
 * Efferd's card: a square, 1px-bordered surface with a plus mark on each
 * corner, built on the shadcn Card with its radius and ring removed. A `title`
 * is a heading row across the top.
 */
export function Panel({
  className,
  children,
  title,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { title?: ReactNode }) {
  return (
    <Card
      className={cn(
        "relative min-w-0 gap-0 rounded-none border bg-background py-0 ring-0",
        className,
      )}
      {...props}
    >
      {Object.entries(CORNERS).map(([corner, position]) => (
        <Plus
          key={corner}
          aria-hidden
          strokeWidth={1}
          className={cn(
            "pointer-events-none absolute z-1 size-6 shrink-0 stroke-muted-foreground",
            position,
          )}
        />
      ))}
      {title !== undefined && (
        <div className="border-b px-4 py-3 text-sm font-medium">{title}</div>
      )}
      {children}
    </Card>
  );
}
