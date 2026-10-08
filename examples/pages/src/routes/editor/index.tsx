import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "../-guards";
import { EditorScreen } from "./-editor-screen";

export const Route = createFileRoute("/editor/")({
  // CSR-only (old app was a pure SPA): the server never renders this route,
  // so no page fetch runs without cookies. beforeLoad is kept for
  // client-side navigations; EditorScreen re-checks via useRequireAuth.
  beforeLoad: ({ location }) => requireAuth(location.href),
  component: NewEditorPage,
  head: () => ({
    meta: [{ title: "New page — Pages" }],
  }),
  ssr: false,
});

/**
 * New page — first half of app/src/routes/editor/[[id]].vue
 * (optional id param, absent here). Editor form is shared with
 * editor/$id.tsx.
 *
 * Trailing-slash note (for the components agent): this file route keeps the
 * `/editor/` path — verified in routeTree.gen.ts (`FileRoutesByTo` maps the
 * canonical `to="/editor"` here, and runtime matching ignores trailing
 * slashes via `exactPathTest`). No `/editor` alias/redirect is needed.
 * Use `to="/editor"` in links (not `to="/editor/"`): the former is the typed
 * form, e.g. dashboard's `to="/editor"` links are already correct.
 */
function NewEditorPage() {
  return <EditorScreen pageId={undefined} />;
}
