import { createPageTool } from "./page/actions/create";
import { deletePageTool } from "./page/actions/delete";
import { echoTool } from "./page/actions/echo";
import { editPageTool } from "./page/actions/edit";
import { getPageTool } from "./page/actions/get";
import { getPageContentTool } from "./page/actions/get-content";
import { getPublicPageTool } from "./page/actions/get-public-page";
// MCP tools barrel: one file per action under ./page/actions.
import { listPagesTool } from "./page/actions/list";
import { renderPageTool } from "./page/actions/render-page";
import { uploadContentTool } from "./page/actions/upload-content";
import { whoamiTool } from "./page/actions/whoami";

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

/** All 11 MCP domain actions in Go `toolList()` order (transport wiring). */
export const pageMcpActions = [
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
];

export interface McpToolDefinition {
  annotations: Record<string, boolean>;
  description: string;
  inputSchema: unknown;
  name: string;
}

// Go `toolList()` parity: read-only vs mutating hints per tool.
const TOOL_ANNOTATIONS: Record<string, Record<string, boolean>> = {
  create_page: { idempotentHint: true },
  delete_page: { destructiveHint: true },
  get_page: { readOnlyHint: true },
  get_page_content: { readOnlyHint: true },
  get_public_page: { readOnlyHint: true },
  list_pages: { readOnlyHint: true },
  render_page: { readOnlyHint: true },
  upload_content: { destructiveHint: false },
  whoami: { readOnlyHint: true },
};

/** JSON-Schema tool registry for the MCP `tools/list` method. */
export function toolList(): McpToolDefinition[] {
  return pageMcpActions.map((action) => ({
    annotations: TOOL_ANNOTATIONS[action.name] ?? {},
    description: action.config.description ?? "",
    inputSchema: action.config.input,
    name: action.name,
  }));
}

export interface McpCallContext {
  user?: { id: string };
}

/**
 * Dispatch an MCP `tools/call` by name. Unknown tools throw; domain errors
 * propagate to the transport, which reports them as `isError` results.
 */
export async function callTool(
  nameOrParams:
    | string
    | {
        arguments?: Record<string, unknown>;
        name?: string;
        params?: { arguments?: Record<string, unknown>; name?: string };
      },
  args?: Record<string, unknown>,
  ctx?: McpCallContext,
): Promise<unknown> {
  const params =
    typeof nameOrParams === "string" ? undefined : (nameOrParams ?? {});
  const nested = params?.params ?? {};
  const name =
    typeof nameOrParams === "string"
      ? nameOrParams
      : (params?.name ?? nested.name);
  const resolvedArgs = (
    typeof nameOrParams === "string"
      ? (args ?? {})
      : (params?.arguments ?? nested.arguments ?? {})
  ) as Record<string, unknown>;
  const action = pageMcpActions.find((candidate) => candidate.name === name);
  if (!action) throw new Error(`unknown tool: ${name}`);
  // Dynamic dispatcher: the brick action union is keyed per tool, so the
  // generic record/partial-context pair needs a cast at this boundary.
  return (action as (params: { ctx?: unknown; input?: unknown }) => unknown)({
    ctx,
    input: resolvedArgs,
  });
}
