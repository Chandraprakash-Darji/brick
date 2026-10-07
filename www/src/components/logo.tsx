import type * as React from "react"
import { cn } from "@/lib/utils"

export function LogoMark({ className, ...props }: React.ComponentProps<"img">) {
  return <img src="/brand/logo.svg" alt="" aria-hidden="true" width={36} height={36} className={cn("brick-logo", className)} {...props} />
}

export function Wordmark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-xl font-semibold tracking-tight", className)} {...props}>
      <LogoMark className="size-9 shrink-0" />
      <span>brick<span className="text-gopher-ink">.</span>ts</span>
    </span>
  )
}
