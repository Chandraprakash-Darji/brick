export function BlogMeta({
  date,
  category,
  version,
}: {
  date: string;
  category: "release" | "guide";
  version?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 self-start font-mono text-xs text-muted-foreground">
      <span className="border border-border px-2 py-1 text-foreground">
        {category === "release" ? "Framework update" : "Building with BrickKit"}
      </span>
      <time dateTime={date}>
        {new Intl.DateTimeFormat("en", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${date}T00:00:00Z`))}
      </time>
      {version && <span>v{version}</span>}
    </div>
  );
}
