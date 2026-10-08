import { defineAppContract } from "@brickkit/core/client";

import { echoTool } from "./services/pages/mcp";
import { pagesResource } from "./services/pages/service";

// Only the echo tool opts into HTTP; the other domain tools use MCP.
export const contract = defineAppContract({
  page: pagesResource,
  pages: { echo: echoTool },
});

export type PagesApi = typeof contract;
