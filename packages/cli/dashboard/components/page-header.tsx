import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl leading-8 font-semibold">{title}</h1>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-1 px-4 py-12 text-center text-sm text-muted-foreground">
      <div>{title}</div>
      {hint && <div className="text-xs">{hint}</div>}
    </div>
  );
}
