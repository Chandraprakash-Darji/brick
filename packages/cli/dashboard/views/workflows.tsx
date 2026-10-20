import { Empty } from "@/components/page-header";
import { cn } from "@/lib/utils";

/**
 * The Workflow SDK's own inspector, served by the dev server at `/workflows`
 * and shown whole in a frame. Like the API reference it stays mounted once
 * opened (`hidden` only hides it), so a run you were reading is still open when
 * you come back.
 */
export function WorkflowsView({
  available,
  hidden,
}: {
  available: boolean;
  hidden: boolean;
}) {
  if (!available)
    return hidden ? null : (
      <Empty
        title="The workflow inspector is not running"
        hint="It needs a workflow listener and @brickkit/workflow-inspector in the project: bun add -d @brickkit/workflow-inspector"
      />
    );
  return (
    <iframe
      title="Workflow inspector"
      src="/workflows/"
      className={cn(
        "h-[calc(100svh-3.5rem)] w-full border-0",
        hidden && "hidden",
      )}
    />
  );
}
