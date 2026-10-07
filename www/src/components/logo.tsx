import type * as React from "react"
import { cn } from "@/lib/utils"

export function Wordmark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-xl font-semibold tracking-tight", className)} {...props}>
      <svg aria-hidden="true" width="30" height="28" viewBox="0 0 30 28" className="text-gopher-ink">
        <path fill="currentColor" d="M0 0h18v7H0zM6 10h24v7H6zM0 20h18v7H0z" />
      </svg>
      <span>brick<span className="text-gopher-ink">.</span></span>
      <span className="font-mono text-[10px] font-normal tracking-normal text-muted-foreground">TS</span>
    </span>
  )
}
