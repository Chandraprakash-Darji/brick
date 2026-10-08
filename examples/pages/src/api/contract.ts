import { defineAppContract } from "@brickkit/core/client";

import {
  createPageTool,
  deletePageTool,
  echoTool,
  editPageTool,
  getPageContentTool,
  getPageTool,
  listPagesTool,
  renderPageTool,
  uploadContentTool,
  whoamiTool,
} from "./services/pages/mcp";
import { pagesResource } from "./services/pages/service";

// Keys match the HTTP resource/service names so clients need only this type.
export const contract = defineAppContract({
  page: pagesResource,
  pages: {
    create_page: createPageTool,
    delete_page: deletePageTool,
    echo: echoTool,
    edit_page: editPageTool,
    get_page: getPageTool,
    get_page_content: getPageContentTool,
    list_pages: listPagesTool,
    render_page: renderPageTool,
    upload_content: uploadContentTool,
    whoami: whoamiTool,
  },
});

export type PagesApi = typeof contract;
