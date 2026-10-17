import { createMcpRegistry } from "@brickkit/core";
import { pagesService } from "./page/service";
import { createPageTool } from "./page/tools/create";
import { deletePageTool } from "./page/tools/delete";
import { echoTool } from "./page/tools/echo";
import { editPageTool } from "./page/tools/edit";
import { getPageTool } from "./page/tools/get";
import { getPageContentTool } from "./page/tools/get-content";
import { getPublicPageTool } from "./page/tools/get-public-page";
// MCP tools barrel: one file per tool under ./page/tools.
import { listPagesTool } from "./page/tools/list";
import { renderPageTool } from "./page/tools/render-page";
import { uploadContentTool } from "./page/tools/upload-content";
import { whoamiTool } from "./page/tools/whoami";

export {
  listPagesTool,
  getPageTool,
  getPageContentTool,
  renderPageTool,
  createPageTool,
  uploadContentTool,
  editPageTool,
  deletePageTool,
  getPublicPageTool,
  echoTool,
  whoamiTool,
};

// Importing the definitions above registers each tool on the service.
export const pageMcpRegistry = createMcpRegistry({ services: [pagesService] });
export const pageMcpActions = pagesService.listTools();
export const toolList = pageMcpRegistry.listTools;
export const callTool = pageMcpRegistry.callTool;
