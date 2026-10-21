import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Sidebar, Topbar } from "@/shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  routeHref,
  useDashboard,
  useRoute,
  useSidebar,
  useTheme,
} from "@/state";
import { Empty } from "@/components/page-header";
import { LogsView } from "@/views/logs";
import { ApisView } from "@/views/apis";
import { ErrorsView } from "@/views/errors";
import { OverviewView } from "@/views/overview";
import { ReloadsView } from "@/views/reloads";
import { RequestsView } from "@/views/requests";
import { WorkflowsView } from "@/views/workflows";

// Fumadocs' components and Shiki's styles are only needed for the Docs tab.
const DocsView = lazy(() => import("@/views/docs"));

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export function App() {
  const state = useDashboard();
  const route = useRoute();
  const { theme, cycle } = useTheme();
  const sidebar = useSidebar();
  const filterRef = useRef<HTMLInputElement>(null);
  const [seenFailure, setSeenFailure] = useState(0);
  // The API reference loads on first visit, then stays alive in the background.
  const production = state.mode === "production";
  const [apisOpened, setApisOpened] = useState(route.view === "apis");
  // The inspector loads on first visit too, then keeps the run you were reading.
  const [workflowsOpened, setWorkflowsOpened] = useState(
    route.view === "workflows",
  );
  const newest = state.failures[0]?.id ?? 0;
  const onErrors = route.view === "errors";
  // Changes whenever the app finishes a request, so stored views can catch up.
  const activity = `${state.traces.length}:${state.traces[0]?.traceId}:${state.traces[0]?.status}`;

  useEffect(() => {
    if (route.view === "apis" && !production) setApisOpened(true);
    if (route.view === "workflows" && !production) setWorkflowsOpened(true);
  }, [route.view, production]);

  // The monitoring dashboard has no APIs, Docs or Workflows; an old link lands on Requests.
  useEffect(() => {
    document.title = production ? "Brick" : "Brick dev";
    if (
      production &&
      (route.view === "apis" ||
        route.view === "docs" ||
        route.view === "workflows")
    )
      location.replace(routeHref("requests"));
  }, [production, route.view]);

  // The errors dot clears once the Errors view has shown the newest failure.
  useEffect(() => {
    if (onErrors) setSeenFailure(newest);
  }, [onErrors, newest]);
  const hasNewErrors = newest > seenFailure;
  // Shown for any app that runs workflows, so the view can say how to turn the inspector on.
  const hasWorkflows =
    state.inspector ||
    (state.architecture?.schema.events?.listeners.some(
      (listener) => listener.kind === "workflow",
    ) ??
      false);

  const focusSearch = useCallback(() => {
    if (route.view === "requests") {
      filterRef.current?.focus();
      return;
    }
    // The filter lives on the Requests view; focus it once that view mounts.
    location.hash = routeHref("requests");
    setTimeout(() => filterRef.current?.focus(), 0);
  }, [route.view]);

  const { toggle: toggleSidebar } = sidebar;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Cmd/Ctrl+B opens and closes the sidebar, as in shadcn's sidebar.
      if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        isTyping(event.target)
      )
        return;
      event.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch, toggleSidebar]);

  const restart = useCallback(() => {
    void fetch("/api/restart", {
      method: "POST",
      headers: { "x-brick-dashboard": "1" },
    });
  }, []);

  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <Sidebar
          view={route.view}
          sidebar={sidebar}
          errorCount={state.failures.length}
          hasNewErrors={hasNewErrors}
          hasDocs={state.docs !== null}
          hasWorkflows={hasWorkflows}
          production={production}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            view={route.view}
            connected={state.connected}
            hasNewErrors={hasNewErrors}
            theme={theme}
            canRestart={state.canRestart}
            production={production}
            sidebarOpen={sidebar.visible && sidebar.expanded}
            onSidebar={sidebar.toggle}
            onSearch={focusSearch}
            onTheme={cycle}
            onRestart={restart}
          />
          <main
            className={cn(
              "flex flex-col gap-4",
              // The API reference, the docs and the inspector bring their own chrome and fill the page.
              route.view === "apis" ||
                route.view === "docs" ||
                route.view === "workflows"
                ? "p-0"
                : "p-6 max-sm:p-4",
            )}
          >
            {route.view === "requests" && (
              <RequestsView
                traces={state.traces}
                historyDays={state.historyDays}
                selectedId={route.traceId}
                activity={activity}
                filterRef={filterRef}
              />
            )}
            {route.view === "overview" && (
              <OverviewView
                architecture={state.architecture}
                traces={state.traces}
              />
            )}
            {apisOpened && !production && (
              <ApisView
                api={state.api}
                route={route}
                traces={state.traces}
                failures={state.failures}
                hidden={route.view !== "apis"}
              />
            )}
            {workflowsOpened && !production && (
              <WorkflowsView
                available={state.inspector}
                hidden={route.view !== "workflows"}
              />
            )}
            {route.view === "docs" && !production && (
              <Suspense fallback={<Empty title="Loading docs" />}>
                <DocsView docs={state.docs} route={route} />
              </Suspense>
            )}
            {route.view === "logs" && <LogsView traces={state.traces} />}
            {route.view === "errors" && (
              <ErrorsView
                failures={state.failures}
                traces={state.traces}
                canLookBack={state.historyDays > 0}
              />
            )}
            {route.view === "reloads" && (
              <ReloadsView reloads={state.reloads} />
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
