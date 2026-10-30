import { ExtensionBoundary } from "@/extension";
import type { ExtensionPage, SlotContext } from "@/extension-registry";

/**
 * A page of the project's extension, behind its own error boundary. A page
 * with a `url` is shown whole in a frame, like the workflow inspector.
 */
export function ExtensionPageView({
  page,
  context,
}: {
  page: ExtensionPage;
  context: SlotContext;
}) {
  if (page.url !== undefined)
    return (
      <iframe
        title={page.label}
        src={page.url}
        className="h-[calc(100svh-3.5rem)] w-full border-0"
      />
    );
  const Page = page.component;
  return (
    <ExtensionBoundary name={`page "${page.id}"`}>
      <Page {...context} path={context.route.path} />
    </ExtensionBoundary>
  );
}
