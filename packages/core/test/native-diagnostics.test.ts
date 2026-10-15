import { expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { Brick } from "../src/native";

const ping = Brick.action("ping", "/ping", {
  input: Schema.Struct({}),
  output: Schema.Struct({ pong: Schema.Boolean }),
  errors: [],
})(() => Effect.succeed({ pong: true }));
const diagnostics = Brick.service("diagnostics", { actions: { ping } });

test("built-in diagnostics serve GET /_health and GET /_brick/services", async () => {
  const app = Brick.app({ services: [diagnostics], layer: Layer.empty });
  try {
    const health = await app.fetch(new Request("http://localhost/_health"));
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("number");

    const graph = await app.fetch(
      new Request("http://localhost/_brick/services"),
    );
    expect(graph.status).toBe(200);
    expect(await graph.json()).toEqual({
      version: "1.0.0",
      services: [
        {
          name: "diagnostics",
          actions: [
            { name: "ping", method: "POST", path: "/ping", mcp: false },
          ],
        },
      ],
    });
  } finally {
    await app.dispose();
  }
});
