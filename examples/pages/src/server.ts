// Custom TanStack Start server entry (auto-discovered as `src/server.ts`).
// Brick-owned paths are served in-process by the pages API; everything
// else falls through to the default Start handler (SSR, assets,
// server functions). See `server/brick.ts` for the owned-path list.
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";

import { handleBrickRequest, isBrickPath } from "./server/brick";

const startFetch = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  fetch(request) {
    if (isBrickPath(new URL(request.url).pathname)) {
      return handleBrickRequest(request);
    }
    return startFetch(request);
  },
});
