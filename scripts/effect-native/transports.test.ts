import { expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSerialization,
  RpcServer,
} from "effect/rpc";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";

class SlugTaken extends Schema.TaggedError<SlugTaken>()("SlugTaken", {
  slug: Schema.String,
}) {}
const Input = Schema.Struct({ slug: Schema.String });
const Output = Schema.Struct({ slug: Schema.String, saved: Schema.Boolean });
const save = ({ slug }: typeof Input.Type) =>
  slug === "taken"
    ? Effect.fail(new SlugTaken({ slug }))
    : Effect.succeed({ slug, saved: true });
const Actions = RpcGroup.make(
  Rpc.make("save", { payload: Input, success: Output, error: SlugTaken }),
);
const Handlers = Actions.toLayer({ save });

// Native HTTP routing and native RPC framing run on a real ephemeral TCP listener.
test("same action works locally and through RPC, including decoded error class", async () => {
  const web = HttpRouter.toWebHandler(
    RpcServer.layerHttp({
      group: Actions,
      path: "/rpc",
      protocol: "http",
    }).pipe(Layer.provide(Handlers), Layer.provide(RpcSerialization.layerJson)),
    { disableLogger: true },
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => web.handler(request),
  });
  try {
    const local = await Effect.runPromise(save({ slug: "hello" }));
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const remote = yield* RpcClient.make(Actions);
        const success = yield* remote.save({ slug: "hello" });
        const failure = yield* remote.save({ slug: "taken" }).pipe(Effect.flip);
        return { success, failure };
      }).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({ url: `${server.url}rpc` }).pipe(
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(RpcSerialization.layerJson),
          ),
        ),
        Effect.scoped,
      ),
    );
    const localFailure = await Effect.runPromise(
      save({ slug: "taken" }).pipe(Effect.flip),
    );
    expect(localFailure).toBeInstanceOf(SlugTaken);
    expect(local).toEqual({ slug: "hello", saved: true });
    expect(outcome.success).toEqual(local);
    expect(outcome.failure).toBeInstanceOf(SlugTaken);
    expect(outcome.failure).toMatchObject({ _tag: "SlugTaken", slug: "taken" });
  } finally {
    await server.stop(true);
    await web.dispose();
  }
});

const SaveTool = Tool.make("save", {
  parameters: Input,
  success: Output,
  failure: SlugTaken,
});
const Tools = Toolkit.make(SaveTool);
const RegisterTools = Layer.effectDiscard(
  McpServer.registerToolkit(Tools),
).pipe(Layer.provide(Tools.toLayer({ save })));
const Auth = HttpRouter.middleware((httpEffect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers.authorization !== "Bearer spike-secret") {
      return HttpServerResponse.jsonUnsafe(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }
    return yield* httpEffect;
  }),
).layer;

const RpcReply = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Number,
  result: Schema.Unknown,
});
const ToolsReply = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({ name: Schema.String, inputSchema: Schema.Unknown }),
  ),
});
const ToolReply = Schema.Struct({
  content: Schema.Array(
    Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  ),
  isError: Schema.optional(Schema.Boolean),
});

test("native MCP discovery and invocation require HTTP request authentication", async () => {
  const app = RegisterTools.pipe(
    Layer.provide(
      McpServer.layerHttp({
        name: "brick-spike",
        version: "0.0.0",
        path: "/mcp",
        protocols: [McpProtocol.v2025_11_25],
      }),
    ),
    Layer.provide(Auth),
  );
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => web.handler(request),
  });
  let sessionId: string | null = null;
  const send = (method: string, params: unknown, token?: string) =>
    fetch(`${server.url}mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  const decodeReply = async (response: Response) => {
    const text = await response.text();
    if (response.status !== 200)
      throw new Error(`HTTP ${response.status}: ${text}`);
    // Streamable HTTP may return SSE framing or a JSON response.
    const payload =
      text.startsWith("event:") || text.startsWith("data:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6)
        : text;
    if (payload === undefined)
      throw new Error(`No MCP response payload: ${text}`);
    return Schema.decodeUnknownSync(RpcReply)(JSON.parse(payload)).result;
  };
  try {
    expect((await send("tools/list", {})).status).toBe(401);
    expect((await send("tools/list", {}, "wrong")).status).toBe(401);
    const initialized = await send(
      "initialize",
      {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "brick-spike-client", version: "0.0.0" },
      },
      "spike-secret",
    );
    sessionId = initialized.headers.get("mcp-session-id");
    expect(sessionId).not.toBeNull();
    await decodeReply(initialized);
    const listed = Schema.decodeUnknownSync(ToolsReply)(
      await decodeReply(await send("tools/list", {}, "spike-secret")),
    );
    expect(listed.tools.map((tool) => tool.name)).toEqual(["save"]);
    expect(
      (
        await send("tools/call", {
          name: "save",
          arguments: { slug: "denied" },
        })
      ).status,
    ).toBe(401);
    const result = Schema.decodeUnknownSync(ToolReply)(
      await decodeReply(
        await send(
          "tools/call",
          { name: "save", arguments: { slug: "from-mcp" } },
          "spike-secret",
        ),
      ),
    );
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ slug: "from-mcp", saved: true }) },
    ]);
  } finally {
    await server.stop(true);
    await web.dispose();
  }
});
