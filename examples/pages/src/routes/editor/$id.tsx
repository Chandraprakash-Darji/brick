import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "../-guards";
import { EditorScreen } from "./-editor-screen";

export const Route = createFileRoute("/editor/$id")({
  // CSR-only (old app was a pure SPA): the server never renders this route,
  // so no page fetch runs without cookies. beforeLoad is kept for
  // client-side navigations; EditorScreen re-checks via useRequireAuth.
  beforeLoad: ({ location }) => requireAuth(location.href),
  component: EditEditorPage,
  head: () => ({
    meta: [{ title: "Edit page — Pages" }],
  }),
  ssr: false,
});

/**
 * Edit existing page — second half of app/src/routes/editor/[[id]].vue
 * (optional id param). Editor form is shared with editor/index.tsx.
 */
function EditEditorPage() {
  const { id } = Route.useParams();
  return <EditorScreen key={id} pageId={id} />;
}
