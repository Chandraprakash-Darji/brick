import type { ReactNode } from "react";
import {
  Activity,
  Bell,
  Blocks,
  BookOpen,
  BookText,
  LayoutGrid,
  Moon,
  PanelLeft,
  RefreshCw,
  RotateCw,
  ScrollText,
  Search,
  Sun,
  SunMoon,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { routeHref, type SidebarState, type Theme, type View } from "@/state";

const NAV: { view: View; label: string; icon: ReactNode }[] = [
  { view: "overview", label: "Overview", icon: <LayoutGrid /> },
  { view: "requests", label: "Requests", icon: <Activity /> },
  { view: "logs", label: "Logs", icon: <ScrollText /> },
  { view: "apis", label: "APIs", icon: <BookOpen /> },
  { view: "docs", label: "Docs", icon: <BookText /> },
  { view: "workflows", label: "Workflows", icon: <Workflow /> },
  { view: "errors", label: "Errors", icon: <TriangleAlert /> },
  { view: "reloads", label: "Reloads", icon: <RefreshCw /> },
];

/**
 * An icon rail that opens to show labels. On narrow screens it slides over the
 * page instead of taking space from it.
 */
export function Sidebar({
  view,
  sidebar,
  errorCount,
  hasNewErrors,
  hasDocs,
  hasWorkflows,
  production,
}: {
  view: View;
  sidebar: SidebarState;
  errorCount: number;
  hasNewErrors: boolean;
  hasDocs: boolean;
  hasWorkflows: boolean;
  /** The monitoring dashboard: no APIs, Docs or Workflows, which need a developer's machine. */
  production: boolean;
}) {
  if (!sidebar.visible) return null;
  const { expanded, desktop } = sidebar;
  return (
    <>
      {!desktop && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          onClick={sidebar.close}
        />
      )}
      <nav
        aria-label="Dashboard"
        data-expanded={expanded}
        className={cn(
          "flex shrink-0 flex-col gap-1 overflow-hidden border-r bg-background p-2 transition-[width] duration-200",
          desktop
            ? "sticky top-0 h-screen"
            : "fixed inset-y-0 left-0 z-50 h-screen shadow-xl",
          expanded ? "w-52" : "w-12",
        )}
      >
        <div className="mb-2 flex h-8 items-center gap-2 px-1.5 whitespace-nowrap [&_svg]:size-[18px] [&_svg]:shrink-0">
          <Blocks />
          {expanded && (
            <span className="font-semibold">
              {production ? "Brick" : "Brick dev"}
            </span>
          )}
        </div>
        {NAV.filter(
          (item) =>
            !(
              production &&
              (item.view === "apis" ||
                item.view === "docs" ||
                item.view === "workflows")
            ) &&
            (item.view !== "docs" || hasDocs) &&
            (item.view !== "workflows" || hasWorkflows),
        ).map((item) => {
          const showCount = item.view === "errors" && errorCount > 0;
          const link = (
            <a
              href={routeHref(item.view)}
              aria-label={item.label}
              aria-current={item.view === view ? "page" : undefined}
              onClick={desktop ? undefined : sidebar.close}
              className={cn(
                "relative flex h-8 items-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
                expanded ? "px-2" : "w-8 justify-center",
              )}
            >
              {item.icon}
              {expanded && (
                <span className="flex-1 truncate">{item.label}</span>
              )}
              {expanded && showCount && (
                <Badge variant={hasNewErrors ? "destructive" : "outline"}>
                  {errorCount}
                </Badge>
              )}
              {!expanded && item.view === "errors" && hasNewErrors && (
                <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" />
              )}
            </a>
          );
          return expanded ? (
            <div key={item.view}>{link}</div>
          ) : (
            <Tooltip key={item.view}>
              <TooltipTrigger render={link} />
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </>
  );
}

const THEME_ICON: Record<Theme, ReactNode> = {
  light: <Sun />,
  dark: <Moon />,
  system: <SunMoon />,
};

export function Topbar({
  view,
  connected,
  hasNewErrors,
  theme,
  canRestart,
  production,
  sidebarOpen,
  onSidebar,
  onSearch,
  onTheme,
  onRestart,
}: {
  view: View;
  connected: boolean;
  hasNewErrors: boolean;
  theme: Theme;
  canRestart: boolean;
  production: boolean;
  sidebarOpen: boolean;
  onSidebar: () => void;
  onSearch: () => void;
  onTheme: () => void;
  onRestart: () => void;
}) {
  const current = NAV.find((item) => item.view === view);
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-6 backdrop-blur-sm supports-backdrop-filter:bg-background/50 max-sm:px-4">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle sidebar"
                aria-expanded={sidebarOpen}
                onClick={onSidebar}
              />
            }
          >
            <PanelLeft />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Toggle sidebar <Kbd>⌘B</Kbd>
          </TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="mr-1 h-4 self-center" />
        <div className="flex items-center gap-2 font-medium [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
          {current?.icon}
          <span>{current?.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {production && <Badge variant="outline">Production</Badge>}
        <span
          role="status"
          className="mr-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <i
            className={cn(
              "size-1.5 rounded-full",
              connected ? "animate-pulse bg-positive" : "bg-destructive",
            )}
          />
          <span className="max-sm:hidden">
            {connected ? "Live" : "Reconnecting"}
          </span>
        </span>
        <Button
          variant="outline"
          className="gap-3 pr-1 pl-2"
          onClick={onSearch}
          aria-label="Search requests"
        >
          <Search />
          <Kbd className="max-sm:hidden">/</Kbd>
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label="Open errors"
          onClick={() => {
            location.hash = routeHref("errors");
          }}
        >
          <Bell />
          {hasNewErrors && (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onTheme}
          aria-label={`Theme: ${theme}`}
          title={`Theme: ${theme}`}
        >
          {THEME_ICON[theme]}
        </Button>
        {canRestart && (
          <Button variant="outline" onClick={onRestart}>
            <RotateCw />
            Restart app
          </Button>
        )}
      </div>
    </header>
  );
}
