import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CornerFrameProps {
  children: ReactNode;
  className?: string;
  /** When given, renders an `<a>` (like TuiCard); otherwise an `<article>`. */
  href?: string;
  style?: CSSProperties;
  id?: string;
}

function FrameSpans() {
  return (
    <>
      <span className="corner tl" aria-hidden="true" />
      <span className="corner tr" aria-hidden="true" />
      <span className="corner bl" aria-hidden="true" />
      <span className="corner br" aria-hidden="true" />
      <span className="edge edge-top" aria-hidden="true" />
      <span className="edge edge-bottom" aria-hidden="true" />
      <span className="edge edge-left" aria-hidden="true" />
      <span className="edge edge-right" aria-hidden="true" />
    </>
  );
}

/**
 * Corner-bracket frame from the TUI component language (see design.md):
 * four solid corner brackets over dotted border edges, styled by the
 * `.corner-card` CSS. Renders an `<a>` when `href` is given, else `<article>`.
 */
export function CornerFrame({
  children,
  className,
  href,
  style,
  id,
}: CornerFrameProps) {
  if (href) {
    return (
      <a
        href={href}
        id={id}
        style={style}
        className={cn("corner-card group relative", className)}
      >
        <FrameSpans />
        {children}
      </a>
    );
  }
  return (
    <article
      id={id}
      style={style}
      className={cn("corner-card group relative", className)}
    >
      <FrameSpans />
      {children}
    </article>
  );
}
