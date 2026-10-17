import {
  useCallback,
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ApiSnapshot,
  ArchitectureSnapshot,
  DevTelemetrySnapshot,
  DocsSnapshot,
  FailureSummary,
  ReloadSummary,
  TraceSummary,
} from "../src/dev-telemetry-store";

const MAX_TRACES = 200;
const MAX_FAILURES = 200;
const MAX_RELOADS = 100;

export interface DashboardState {
  traces: TraceSummary[];
  failures: FailureSummary[];
  reloads: ReloadSummary[];
  architecture: ArchitectureSnapshot | null;
  /** The OpenAPI documents the app offers; null until the app has started. */
  api: ApiSnapshot | null;
  /** The app's developer documentation; null when it has none. */
  docs: DocsSnapshot | null;
  canRestart: boolean;
  /** Days of requests kept on disk; zero when history is off. */
  historyDays: number;
  /** `production` is the monitoring dashboard `brick start` serves: read-only, with no APIs or Docs. */
  mode: "dev" | "production";
  connected: boolean;
  loaded: boolean;
}

/** What the dashboard server adds to the store's snapshot. */
interface ServerFields {
  canRestart: boolean;
  historyDays: number;
  mode: "dev" | "production";
}

type Action =
  | {
      type: "snapshot";
      snapshot: DevTelemetrySnapshot & ServerFields;
    }
  | { type: "trace"; trace: TraceSummary }
  | { type: "failure"; failure: FailureSummary }
  | { type: "reload"; reload: ReloadSummary }
  | { type: "architecture"; architecture: ArchitectureSnapshot }
  | { type: "api"; api: ApiSnapshot }
  | { type: "docs"; docs: DocsSnapshot | null }
  | { type: "connection"; connected: boolean };

export const initialState: DashboardState = {
  traces: [],
  failures: [],
  reloads: [],
  architecture: null,
  api: null,
  docs: null,
  canRestart: false,
  historyDays: 0,
  mode: "dev",
  connected: false,
  loaded: false,
};

export function reduce(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        traces: action.snapshot.traces,
        failures: action.snapshot.failures,
        reloads: action.snapshot.reloads,
        architecture: action.snapshot.architecture,
        api: action.snapshot.api,
        docs: action.snapshot.docs,
        canRestart: action.snapshot.canRestart,
        historyDays: action.snapshot.historyDays,
        mode: action.snapshot.mode ?? "dev",
        loaded: true,
      };
    case "trace": {
      const index = state.traces.findIndex(
        (trace) => trace.traceId === action.trace.traceId,
      );
      if (index >= 0) {
        const traces = state.traces.slice();
        traces[index] = action.trace;
        return { ...state, traces };
      }
      return {
        ...state,
        traces: [action.trace, ...state.traces].slice(0, MAX_TRACES),
      };
    }
    case "failure":
      return {
        ...state,
        failures: [action.failure, ...state.failures].slice(0, MAX_FAILURES),
      };
    case "reload":
      return {
        ...state,
        reloads: [action.reload, ...state.reloads].slice(0, MAX_RELOADS),
      };
    case "architecture":
      return { ...state, architecture: action.architecture };
    case "api":
      return { ...state, api: action.api };
    case "docs":
      return { ...state, docs: action.docs };
    case "connection":
      return { ...state, connected: action.connected };
  }
}

/** Subscribe to the dashboard's event stream; it reconnects on its own. */
export function useDashboard(): DashboardState {
  const [state, dispatch] = useReducer(reduce, initialState);
  useEffect(() => {
    const source = new EventSource("/api/events");
    const listen = <T>(name: string, handle: (data: T) => void) =>
      source.addEventListener(name, (event) =>
        handle(JSON.parse((event as MessageEvent<string>).data) as T),
      );
    listen<DevTelemetrySnapshot & ServerFields>("snapshot", (snapshot) =>
      dispatch({ type: "snapshot", snapshot }),
    );
    listen<{ trace: TraceSummary }>("trace", ({ trace }) =>
      dispatch({ type: "trace", trace }),
    );
    listen<{ failure: FailureSummary }>("failure", ({ failure }) =>
      dispatch({ type: "failure", failure }),
    );
    listen<{ reload: ReloadSummary }>("reload", ({ reload }) =>
      dispatch({ type: "reload", reload }),
    );
    listen<{ architecture: ArchitectureSnapshot }>(
      "architecture",
      ({ architecture }) => dispatch({ type: "architecture", architecture }),
    );
    listen<{ api: ApiSnapshot }>("api", ({ api }) =>
      dispatch({ type: "api", api }),
    );
    listen<{ docs: DocsSnapshot | null }>("docs", ({ docs }) =>
      dispatch({ type: "docs", docs }),
    );
    source.onopen = () => dispatch({ type: "connection", connected: true });
    source.onerror = () => dispatch({ type: "connection", connected: false });
    return () => source.close();
  }, []);
  return state;
}

export type View =
  | "requests"
  | "logs"
  | "overview"
  | "apis"
  | "docs"
  | "errors"
  | "reloads";
export interface Route {
  view: View;
  traceId?: string;
  /** Segments after the view, for views with pages of their own (APIs, Docs). */
  path: string[];
  /** The `#heading` after a docs page's path. */
  anchor?: string;
}

const VIEWS: View[] = [
  "requests",
  "logs",
  "overview",
  "apis",
  "docs",
  "errors",
  "reloads",
];

/** A path segment as written, when it is not valid percent-encoding. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRoute(hash: string): Route {
  const body = hash.replace(/^#\/?/, "");
  // A second `#` names a heading inside a docs page: #/docs/guide/setup#install
  const anchorAt = body.indexOf("#");
  const location = anchorAt >= 0 ? body.slice(0, anchorAt) : body;
  const anchor = anchorAt >= 0 ? decode(body.slice(anchorAt + 1)) : undefined;
  const [view, ...rest] = location.split("/");
  const path = rest.filter(Boolean).map(decode);
  return {
    // History became part of Requests; old links still land there.
    view: VIEWS.includes(view as View) ? (view as View) : "requests",
    traceId: path[0],
    path,
    ...(anchor ? { anchor } : {}),
  };
}

export function routeHref(view: View, traceId?: string): string {
  return traceId ? `#/${view}/${encodeURIComponent(traceId)}` : `#/${view}`;
}

/** The address of a docs page, optionally at one of its headings. */
export function docsHref(path: string[], anchor?: string): string {
  const pages = path.map(encodeURIComponent).join("/");
  return `#/docs${pages ? `/${pages}` : ""}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

/** The view and selected request, kept in the URL hash so links can be shared. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

export type Theme = "light" | "dark" | "system";
const THEME_KEY = "brick-dashboard-theme";

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(): { theme: Theme; cycle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  });
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [theme]);
  const cycle = useCallback(() => {
    setTheme((current) => {
      const next: Theme =
        current === "system" ? "dark" : current === "dark" ? "light" : "system";
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);
  return { theme, cycle };
}

/** Current time, refreshed while `active` so running requests keep growing. */
export function useNow(active: boolean, intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

const SIDEBAR_KEY = "brick-dashboard-sidebar";

export interface SidebarState {
  /** Wide screens keep the sidebar in the layout; narrow ones overlay it. */
  desktop: boolean;
  /** Whether labels are showing next to the icons. */
  expanded: boolean;
  /** Whether the sidebar is on screen at all. */
  visible: boolean;
  toggle: () => void;
  close: () => void;
}

/**
 * The sidebar is an icon rail that opens to show labels. The choice is saved
 * for wide screens; on narrow screens it opens as an overlay instead.
 */
export function useSidebar(): SidebarState {
  const desktop = useMediaQuery("(min-width: 768px)");
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "expanded",
  );
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    if (desktop) setOverlay(false);
  }, [desktop]);

  const toggle = useCallback(() => {
    if (!desktop) {
      setOverlay((open) => !open);
      return;
    }
    setExpanded((open) => {
      localStorage.setItem(SIDEBAR_KEY, open ? "collapsed" : "expanded");
      return !open;
    });
  }, [desktop]);

  return {
    desktop,
    expanded: desktop ? expanded : true,
    visible: desktop || overlay,
    toggle,
    close: useCallback(() => setOverlay(false), []),
  };
}
