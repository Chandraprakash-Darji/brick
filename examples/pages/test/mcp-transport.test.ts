import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { createHash } from "node:crypto";
import { overrideSecret, resetSecrets } from "@brickkit/core";
import { prepareTestDatabase } from "./database";
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("native MCP with OAuth bearer validation", () => {
  test("challenges missing tokens, advertises discovery, and authenticates tools over session protocol", async () => {
    const port = 3999,
      base = `http://127.0.0.1:${port}`;
    overrideSecret("BASE_URL", base);
    overrideSecret("MCP_RESOURCE", `${base}/mcp`);
    const db = await prepareTestDatabase();
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: db.app.fetch,
    });
    try {
      await db.app.ready();
      const secret = "pages-agent-secret-value",
        client = "native-pages-client";
      await db.sql`insert into oauth_client (id,client_id,client_secret,grant_types,redirect_uris,scopes,client_credentials_scopes,token_endpoint_auth_method) values ('client-row',${client},${createHash("sha256").update(secret).digest("base64url")},ARRAY['client_credentials'],ARRAY[]::text[],ARRAY['read:pages'],ARRAY['read:pages'],'client_secret_post')`;
      await db.sql`insert into oauth_client_resource(id,client_id,resource_id) values('client-resource',${client},${`${base}/mcp`})`;
      let session: string | null = null;
      const send = (method: string, params: unknown = {}, token?: string) =>
        fetch(`${base}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
            ...(session ? { "mcp-session-id": session } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
      const denied = await send("tools/list");
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toContain(
        "resource_metadata=",
      );
      const metadata = await (
        await fetch(`${base}/.well-known/oauth-protected-resource`)
      ).json();
      expect(metadata.resource).toBe(`${base}/mcp`);
      const tokenResponse = await fetch(`${base}/api/auth/oauth2/token`, {
        method: "POST",
        body: new URLSearchParams({
          client_id: client,
          client_secret: secret,
          grant_type: "client_credentials",
          resource: `${base}/mcp`,
          scope: "read:pages",
        }),
      });
      const token = await tokenResponse.json();
      expect(tokenResponse.status, JSON.stringify(token)).toBe(200);
      const initialized = await send(
        "initialize",
        {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "pages-test", version: "1" },
        },
        token.access_token,
      );
      expect(initialized.status, await initialized.clone().text()).toBe(200);
      session = initialized.headers.get("mcp-session-id");
      expect(session).toBeString();
      await initialized.text();
      const listed = await send("tools/list", {}, token.access_token);
      expect(listed.status).toBe(200);
      const body = await listed.text();
      const payload =
        body.startsWith("event:") || body.startsWith("data:")
          ? body
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6)
          : body;
      if (payload === undefined)
        throw new Error("MCP tools/list returned no response payload");
      const decoded = Schema.decodeUnknownSync(
        Schema.Struct({
          result: Schema.Struct({
            tools: Schema.Array(
              Schema.Struct({
                name: Schema.String,
                description: Schema.String,
                annotations: Schema.Struct({
                  title: Schema.String,
                  readOnlyHint: Schema.optionalKey(Schema.Boolean),
                  destructiveHint: Schema.optionalKey(Schema.Boolean),
                  idempotentHint: Schema.optionalKey(Schema.Boolean),
                }),
              }),
            ),
          }),
        }),
      )(JSON.parse(payload));
      expect(decoded.result.tools).toHaveLength(11);
      const listTool = decoded.result.tools.find(
        (tool) => tool.name === "list_pages",
      );
      expect(listTool?.description).toContain(
        "owned by the authenticated user",
      );
      expect(listTool?.annotations.title).toBe("List Pages");
      expect(listTool?.annotations.readOnlyHint).toBe(true);
      expect(
        decoded.result.tools.find((tool) => tool.name === "delete_page")
          ?.annotations.destructiveHint,
      ).toBe(true);
      expect(
        decoded.result.tools.find((tool) => tool.name === "create_page")
          ?.annotations.idempotentHint,
      ).toBe(true);
      for (const name of [
        "create_page",
        "list_pages",
        "get_page",
        "echo",
        "whoami",
      ])
        expect(body).toContain(name);
      const echoed = await send(
        "tools/call",
        { name: "echo", arguments: { message: "native" } },
        token.access_token,
      );
      expect(echoed.status).toBe(200);
      expect(await echoed.text()).toContain("Echo: native");
    } finally {
      await server.stop(true);
      await db.close();
      resetSecrets();
    }
  }, 30000);
});
