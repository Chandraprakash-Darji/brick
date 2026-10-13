import type { ExampleTable } from "@/lib/examples";

/** One database table: its name and columns with type and key flags. */
export function DatabaseTable({ name, columns }: ExampleTable) {
  return (
    <figure className="overflow-hidden rounded-lg border bg-card">
      <figcaption className="border-b px-4 py-2.5 font-mono text-sm font-medium">
        {name}
      </figcaption>
      {columns.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          No column metadata.
        </p>
      ) : (
        <table className="w-full text-left font-mono text-xs">
          <tbody>
            {columns.map((column) => (
              <tr key={column.name} className="border-b last:border-b-0">
                <th scope="row" className="px-4 py-1.5 font-normal">
                  {column.name}
                </th>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {column.type}
                </td>
                <td className="px-4 py-1.5 text-right text-gopher-ink">
                  {column.primary ? "PK" : column.notNull ? "NOT NULL" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
