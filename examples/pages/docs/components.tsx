/**
 * Components the docs can use besides Fumadocs' own. The dashboard bundles this
 * file, so it can import anything the project has. Export them by name.
 */
const COLORS: Record<string, string> = {
  GET: "#2563eb",
  POST: "#16a34a",
  PATCH: "#d97706",
  DELETE: "#dc2626",
};

export function Endpoint({
  method,
  path,
  note,
}: {
  method: string;
  path: string;
  note?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "8px 0",
        padding: "8px 12px",
        border: "1px solid var(--color-fd-border)",
        borderRadius: 8,
        fontSize: 14,
      }}
    >
      <b style={{ color: COLORS[method] ?? "inherit", minWidth: 56 }}>
        {method}
      </b>
      <code>{path}</code>
      {note && <span style={{ opacity: 0.7 }}>{note}</span>}
    </div>
  );
}

export const components = { Endpoint };
