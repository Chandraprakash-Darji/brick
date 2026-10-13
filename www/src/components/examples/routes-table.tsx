import type { ExampleService } from "@/lib/examples";

/** Actions with their HTTP route and access policy, one table per service. */
export function RoutesTable({
  services,
}: {
  readonly services: ExampleService[];
}) {
  return (
    <div className="space-y-8">
      {services.map((service) => (
        <div key={service.name}>
          <h3 className="mb-3 font-mono text-sm text-muted-foreground">
            {service.name}
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Method</th>
                  <th className="px-4 py-2 font-medium">Path</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Access</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {service.actions.map((action) => (
                  <tr key={action.name} className="border-b last:border-b-0">
                    <td className="px-4 py-2 text-gopher-ink">
                      {action.method ?? "—"}
                    </td>
                    <td className="px-4 py-2">{action.path ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {action.name}
                    </td>
                    <td className="px-4 py-2">
                      {action.accessPolicy ??
                        (action.hasAuthorize ? "authorized" : "public")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
