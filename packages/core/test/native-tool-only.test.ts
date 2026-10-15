import { expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol } from "effect/ai";
import { Brick } from "../src/native";

const lookup = Brick.action("lookup", "/lookup", {
  input: Schema.Struct({ value: Schema.String }),
  output: Schema.String,
  errors: [],
})((input) => Effect.succeed(`http:${input.value}`));

// Tool-only: MCP and in-process calls work, but no HTTP route is mounted.
// No path needed — tool-only actions omit it.
const secret = Brick.action("secret", {
  input: Schema.Struct({ value: Schema.String }),
  output: Schema.String,
  errors: [],
  expose: "mcp",
})((input) => Effect.succeed(`tool:${input.value}`));

const service = Brick.service("pages", { actions: { lookup, secret } });
const Reply = Schema.Struct({ result: Schema.Unknown });
const Tools = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ name: Schema.String })),
});

test("tool-only actions skip HTTP but stay on MCP and in-process calls", async () => {
  const app = Brick.app({
    services: [service],
    layer: Layer.empty,
    transports: {
      mcp: {
        name: "brick",
        version: "1",
        path: "/mcp",
        protocols: [McpProtocol.v2025_11_25],
      },
    },
  });
  const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) });
  try {
    const http = await app.fetch(
      new Request("http://localhost/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"value":"x"}',
      }),
    );
    expect(http.status).toBe(200);
    expect(await http.json()).toBe("http:x");

    const hidden = await app.fetch(
      new Request("http://localhost/secret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"value":"x"}',
      }),
    );
    expect(hidden.status).toBe(404);

    const graph = (await (
      await app.fetch(new Request("http://localhost/_brick/services"))
    ).json()) as {
      services: {
        actions: { name: string; http: boolean; mcp: boolean }[];
      }[];
    };
    expect(graph.services[0]?.actions).toEqual([
      {
        name: "lookup",
        method: "POST",
        path: "/lookup",
        mcp: false,
        http: true,
      },
      {
        name: "secret",
        method: "POST",
        path: "/secret",
        mcp: true,
        http: false,
      },
    ]);

    let session: string | null = null;
    const mcp = (method: string, params: unknown) =>
      fetch(new URL("mcp", server.url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
          ...(session ? { "mcp-session-id": session } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    const initialized = await mcp("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(initialized.status).toBe(200);
    session = initialized.headers.get("mcp-session-id");
    await initialized.text();
    const listed = await mcp("tools/list", {});
    expect(listed.status).toBe(200);
    const text = await listed.text();
    const data =
      text.startsWith("event:") || text.startsWith("data:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6)
        : text;
    if (!data) throw new Error("Missing MCP response");
    const tools = Schema.decodeUnknownSync(Tools)(
      Schema.decodeUnknownSync(Reply)(JSON.parse(data)).result,
    ).tools.map((tool) => tool.name);
    expect(tools).toEqual(["secret"]);

    expect(await Effect.runPromise(secret.handler({ value: "x" }))).toBe(
      "tool:x",
    );
  } finally {
    await server.stop(true);
    await app.dispose();
  }
});

test("tool-only actions do not collide with HTTP routes", () => {
  const other = Brick.service("other", {
    actions: {
      secret: Brick.action("secret", "/secret", {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.String,
        errors: [],
      })((input) => Effect.succeed(input.value)),
    },
  });
  expect(() =>
    Brick.app({ services: [service, other], layer: Layer.empty }),
  ).not.toThrow();
});
