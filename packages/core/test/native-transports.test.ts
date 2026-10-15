import { expect, test } from "bun:test";
import { Context, Effect, Layer, Schema, Result as Outcome } from "effect";
import {
  FetchHttpClient,
  HttpServerRequest,
  HttpClient,
  HttpClientRequest,
} from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { McpProtocol } from "effect/ai";
import { Brick } from "../src/native";

class Repo extends Context.Service<Repo, string>()("native-transports/Repo") {}
const Define = Brick.action("lookup", "/lookup", {
  input: Schema.Struct({ value: Schema.String }),
  output: Schema.String,
  errors: [Brick.errors.Forbidden],
  mcp: true,
});
const lookup = Define((input) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers.authorization !== "Bearer alice")
      return yield* new Brick.errors.Forbidden({ message: "Access denied" });
    const prefix = yield* Repo;
    return prefix + input.value;
  }),
);
const privateAction = Brick.action("private", "/private", {
  input: Schema.Struct({}),
  output: Schema.String,
  errors: [],
})(() => Effect.succeed("private"));
const service = Brick.service("pages", {
  actions: { lookup, private: privateAction },
});
const group = Brick.rpcGroup({ lookup: Define });
const Reply = Schema.Struct({ result: Schema.Unknown });
const Tools = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ name: Schema.String })),
});
const Result = Schema.Struct({
  content: Schema.Array(Schema.Struct({ text: Schema.String })),
  isError: Schema.optionalKey(Schema.Boolean),
});

const missing = () =>
  Brick.app({
    services: [service],
    // @ts-expect-error The shared repository must be supplied for every protocol.
    layer: Layer.empty,
    transports: { rpc: { path: "/rpc" } },
  });
void missing;

test("native HTTP, RPC and opt-in MCP share authorization, request context and one scoped repository", async () => {
  let acquisitions = 0;
  let releases = 0;
  const dependencies = Layer.effect(
    Repo,
    Effect.acquireRelease(
      Effect.sync(() => {
        acquisitions++;
        return "repo:";
      }),
      () =>
        Effect.sync(() => {
          releases++;
        }),
    ),
  );
  const app = Brick.app({
    services: [service],
    layer: dependencies,
    transports: {
      rpc: { path: "/rpc" },
      mcp: {
        name: "brick",
        version: "1",
        path: "/mcp",
        protocols: [McpProtocol.v2025_11_25],
      },
    },
  });
  const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) });
  const http = (token: string) =>
    fetch(new URL("lookup", server.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: '{"value":"http"}',
    });
  const rpc = (token: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(group);
        return yield* client
          .lookup(
            { value: "rpc" },
            { headers: { authorization: `Bearer ${token}` } },
          )
          .pipe(Effect.result);
      }).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({
            url: new URL("rpc", server.url).toString(),
            transformClient: (client) =>
              HttpClient.mapRequest(client, (request) =>
                HttpClientRequest.setHeader(
                  request,
                  "authorization",
                  `Bearer ${token}`,
                ),
              ),
          }).pipe(
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(RpcSerialization.layerJson),
          ),
        ),
        Effect.scoped,
      ),
    );
  let session: string | null = null;
  const mcp = (method: string, params: unknown, token = "alice") =>
    fetch(new URL("mcp", server.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        authorization: `Bearer ${token}`,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  const result = async (response: Response) => {
    expect(response.status).toBe(200);
    const text = await response.text();
    const data =
      text.startsWith("event:") || text.startsWith("data:")
        ? text
            .split("\n")
            .find((l) => l.startsWith("data: "))
            ?.slice(6)
        : text;
    if (!data) throw new Error("Missing MCP response");
    return Schema.decodeUnknownSync(Reply)(JSON.parse(data)).result;
  };
  try {
    const [allowed, denied] = await Promise.all([http("alice"), http("bob")]);
    expect(await allowed.json()).toBe("repo:http");
    expect(denied.status).toBe(403);
    const [rpcAllowed, rpcDenied] = await Promise.all([
      rpc("alice"),
      rpc("bob"),
    ]);
    expect(Outcome.isSuccess(rpcAllowed)).toBe(true);
    if (Outcome.isSuccess(rpcAllowed))
      expect(rpcAllowed.success).toBe("repo:rpc");
    expect(Outcome.isFailure(rpcDenied)).toBe(true);
    if (Outcome.isFailure(rpcDenied))
      expect(rpcDenied.failure).toBeInstanceOf(Brick.errors.Forbidden);
    const initialized = await mcp("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    session = initialized.headers.get("mcp-session-id");
    await result(initialized);
    expect(
      Schema.decodeUnknownSync(Tools)(
        await result(await mcp("tools/list", {})),
      ).tools.map((tool) => tool.name),
    ).toEqual(["lookup"]);
    expect(
      Schema.decodeUnknownSync(Result)(
        await result(
          await mcp("tools/call", {
            name: "lookup",
            arguments: { value: "mcp" },
          }),
        ),
      ),
    ).toMatchObject({ content: [{ text: "repo:mcp" }] });
    expect(
      Schema.decodeUnknownSync(Result)(
        await result(
          await mcp(
            "tools/call",
            { name: "lookup", arguments: { value: "mcp" } },
            "bob",
          ),
        ),
      ).isError,
    ).toBe(true);
    expect(acquisitions).toBe(1);
    expect(releases).toBe(0);
  } finally {
    await server.stop(true);
    await app.dispose();
  }
  expect(releases).toBe(1);
});
