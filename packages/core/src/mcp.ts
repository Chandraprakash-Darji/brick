import type { ActionContext, Service, Tool, ToolAnnotations } from "./types";

export interface McpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: unknown;
  annotations: ToolAnnotations;
}

export interface McpRegistryOptions {
  services?: readonly Pick<Service<any, any>, "listTools">[];
  tools?: readonly Tool<any, any, any, any>[];
}

export interface McpRegistry {
  listTools(): McpToolDefinition[];
  callTool(
    name: string,
    args?: Record<string, unknown>,
    ctx?: Partial<ActionContext>,
  ): Promise<unknown>;
}

export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`unknown tool: ${name}`);
    this.name = "UnknownToolError";
  }
}

/** Collect only explicitly defined tools, without exposing ordinary actions. */
export function createMcpRegistry(options: McpRegistryOptions): McpRegistry {
  function toolsByName() {
    const tools = new Map<string, Tool<any, any, any, any>>();
    for (const tool of [
      ...(options.tools ?? []),
      ...(options.services ?? []).flatMap((service) => service.listTools()),
    ]) {
      const existing = tools.get(tool.name);
      if (existing && existing !== tool)
        throw new Error(`Duplicate MCP tool: ${tool.name}`);
      tools.set(tool.name, tool);
    }
    return tools;
  }
  toolsByName();
  return {
    listTools: () =>
      Array.from(toolsByName().values(), (tool) => ({
        name: tool.name,
        ...((tool.config.title ?? tool.config.annotations?.title)
          ? { title: tool.config.title ?? tool.config.annotations?.title }
          : {}),
        description: tool.config.description ?? "",
        inputSchema: tool.config.input ?? {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: tool.config.annotations ?? {},
      })),
    async callTool(name, args = {}, ctx) {
      const tool = toolsByName().get(name);
      if (!tool) throw new UnknownToolError(name);
      return tool({ input: args, ctx });
    },
  };
}

export interface McpHandlerOptions {
  registry: McpRegistry;
  serverInfo: { name: string; version: string; title?: string };
  /** Versions supported by this transport, newest first. */
  protocolVersions?: readonly string[];
}

function result(id: unknown, value: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result: value });
}
function rpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Stateless MCP JSON-RPC POST handler. Wrap with the app's authentication. */
export function createMcpHandler(options: McpHandlerOptions) {
  const versions = options.protocolVersions ?? ["2025-06-18"];
  if (!versions.length)
    throw new Error("At least one MCP protocol version is required");
  return async (
    request: Request,
    ctx?: Partial<ActionContext>,
  ): Promise<Response> => {
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return rpcError(null, -32700, "parse error");
    }
    if (
      !isRecord(body) ||
      body.jsonrpc !== "2.0" ||
      typeof body.method !== "string" ||
      (body.id !== undefined &&
        body.id !== null &&
        typeof body.id !== "string" &&
        typeof body.id !== "number") ||
      (body.params !== undefined && !isRecord(body.params))
    ) {
      return rpcError(null, -32600, "invalid request");
    }
    if (body.id === undefined) return new Response(null, { status: 202 });
    const { id, method } = body;
    const params = body.params as Record<string, unknown> | undefined;
    switch (method) {
      case "initialize": {
        const requested = params?.protocolVersion;
        return result(id, {
          capabilities: { tools: {} },
          protocolVersion:
            typeof requested === "string" && versions.includes(requested)
              ? requested
              : versions[0],
          serverInfo: options.serverInfo,
        });
      }
      case "ping":
        return result(id, {});
      case "tools/list":
        try {
          return result(id, { tools: options.registry.listTools() });
        } catch {
          return rpcError(id, -32603, "internal error");
        }
      case "tools/call": {
        if (
          typeof params?.name !== "string" ||
          (params.arguments !== undefined && !isRecord(params.arguments))
        ) {
          return rpcError(id, -32602, "invalid tool parameters");
        }
        try {
          const value = await options.registry.callTool(
            params.name,
            params.arguments as Record<string, unknown> | undefined,
            { ...ctx, request },
          );
          return result(id, {
            content: [
              {
                type: "text",
                text:
                  typeof value === "string"
                    ? value
                    : (JSON.stringify(value, null, 2) ?? "null"),
              },
            ],
          });
        } catch (error) {
          if (error instanceof UnknownToolError)
            return rpcError(id, -32602, error.message);
          return result(id, {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          });
        }
      }
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  };
}
