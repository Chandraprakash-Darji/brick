import { defineDashboard, Panel, useAppFetch } from "@brickkit/cli/dashboard";

function Queues() {
  const { data } = useAppFetch<{ waiting: number }>("/api/queues");
  return (
    <Panel title="Queues">
      <div className="bg-chart-3 p-7">{data?.waiting}</div>
    </Panel>
  );
}

export default defineDashboard({
  pages: [
    {
      id: "queues",
      label: "Queues",
      after: "overview",
      production: true,
      component: Queues,
    },
  ],
});
