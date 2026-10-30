import { defineDashboard, Panel } from "@brickkit/cli/dashboard";

function Comments() {
  return <Panel title="Comments">From a plugin</Panel>;
}

export default defineDashboard({
  pages: [{ id: "comments", label: "Comments", component: Comments }],
});
