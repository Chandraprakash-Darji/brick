import { defineDashboard, Panel, useAppFetch } from "@brickkit/cli/dashboard";

/** The latest comments on pages, read from the app through `/app`. */
function LatestComments() {
  const { data, error } = useAppFetch<{
    items: { id: string; targetId: string; body: string }[];
  }>("/api/pages/page-comment/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit: 20 }),
  });
  return (
    <Panel title="Latest comments">
      {error ? (
        <p className="p-4 text-sm text-destructive">{String(error)}</p>
      ) : (
        <ul className="divide-y text-sm">
          {(data?.items ?? []).map((comment) => (
            <li key={comment.id} className="px-4 py-2">
              <span className="text-muted-foreground">{comment.targetId}</span>{" "}
              {comment.body}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default defineDashboard({
  pages: [{ id: "comments", label: "Comments", component: LatestComments }],
});
