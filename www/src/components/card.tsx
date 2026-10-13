import * as React from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CardProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "title"
> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  arrow?: boolean;
}

export function Card({
  title,
  description,
  icon,
  href,
  arrow,
  className,
  children,
  ...props
}: CardProps) {
  if (!href) {
    if (arrow) {
      throw new Error("Card has arrow styling but no href.");
    }
    if (
      className &&
      (/\bhover:/.test(className) || /\bcursor-pointer\b/.test(className))
    ) {
      throw new Error("Card has hover or pointer styling but no href.");
    }
    return (
      <div
        data-card="true"
        className={cn(
          "block rounded-xl border border-border bg-card p-4 text-card-foreground",
          className,
        )}
        {...props}
      >
        {icon && (
          <div className="not-prose mb-2 w-fit rounded-lg border border-border bg-muted p-1.5 text-muted-foreground [&_svg]:size-4">
            {icon}
          </div>
        )}
        {title && (
          <h3 className="not-prose mb-1 text-sm font-medium">{title}</h3>
        )}
        {description && (
          <p className="my-0! text-sm text-muted-foreground">{description}</p>
        )}
        <div className="text-sm text-muted-foreground prose-no-margin empty:hidden">
          {children}
        </div>
      </div>
    );
  }

  const showArrow = arrow ?? true;

  return (
    <a
      href={href}
      data-card="true"
      className={cn(
        "group block rounded-xl border border-border bg-card p-4 text-card-foreground transition-colors hover:border-foreground/30 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        {icon && (
          <div className="not-prose mb-2 w-fit rounded-lg border border-border bg-muted p-1.5 text-muted-foreground [&_svg]:size-4">
            {icon}
          </div>
        )}
        {showArrow && (
          <ArrowUpRightIcon
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
            aria-hidden="true"
          />
        )}
      </div>
      {title && <h3 className="not-prose mb-1 text-sm font-medium">{title}</h3>}
      {description && (
        <p className="my-0! text-sm text-muted-foreground">{description}</p>
      )}
      <div className="text-sm text-muted-foreground prose-no-margin empty:hidden">
        {children}
      </div>
    </a>
  );
}

export function Cards({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-cards="true"
      className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}
