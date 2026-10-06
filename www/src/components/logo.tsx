import type * as React from "react"
import { cn } from "@/lib/utils"

const bangs = [
  "text-bang-1 -rotate-9 [--bang-delay:0.3s]",
  "text-bang-2 rotate-6 [--bang-delay:0.6s]",
  "text-bang-3 -rotate-4 [--bang-delay:0.9s]",
  "text-bang-4 rotate-8 [--bang-delay:1.2s]",
  "text-bang-5 -rotate-6 [--bang-delay:1.5s]",
]

export function Wordmark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("font-semibold tracking-tight inline-flex items-center gap-1.5 text-[17px]", className)} {...props}>
      <span className="font-bold tracking-tight">Brick</span>
      <span aria-hidden="true" className="ml-px font-extrabold tracking-normal">
        {bangs.map((bang, i) => (
          <span key={i} className={cn("inline-block motion-safe:animate-bang", bang)}>
            !
          </span>
        ))}
      </span>
      <span className="label ml-1 rounded border border-border bg-muted/70 px-1.5 py-0.5 text-[9px] font-mono leading-none tracking-normal">
        TS
      </span>
    </span>
  )
}
