import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";

import { overrideSecret, resetSecrets } from "@brickkit/core";

import { oauthClient, oauthClientResource } from "../src/api/auth/schema";
import { buildApp } from "../src/api/app";
import { prepareTestDatabase } from "./database";

// Port of server/mcp_test.go TestMCP_BearerProtectedEcho (SQLite): an OAuth
// client_credentials token authorizes an MCP tools/call, and missing tokens
// yield a 401 with a WWW-Authenticate header pointing at the
// protected-resource metadata. Real HTTP against a listening server, since
// bearer verification resolves the AS JWKS over HTTP.

const TEST_PORT = 3999;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const MCP_RESOURCE = `${BASE_URL}/mcp`;

type TestDatabase = Awaited<ReturnType<typeof prepareTestDatabase>>;

let app: ReturnType<typeof buildApp> | null = null;
let testDb: TestDatabase | null = null;

/** Go `hashSecret` parity: SHA-256 + base64url (matches the plugin hasher). */
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

async function mcpToken(): Promise<string> {
  // Confidential client with the "read:pages" scope (Go parity: inserted
  // directly; unauthenticated registration cannot grant client_credentials).
  const clientId = "pages-agent-client";
  const secret = "pages-agent-secret-value";
  await testDb!
    .getDb()
    .insert(oauthClient)
    .values({
      clientCredentialsScopes: ["read:pages"],
      clientId,
      clientSecret: hashSecret(secret),
      grantTypes: ["client_credentials"],
      id: "client-row-1",
      redirectUris: [],
      scopes: ["read:pages"],
      tokenEndpointAuthMethod: "client_secret_post",
    });
  // Link the client to the MCP resource (dynamic registration does this via
  // clientRegistrationDefaultResources; direct inserts must do it manually).
  await testDb!.getDb().insert(oauthClientResource).values({
    clientId,
    id: "client-resource-1",
    resourceId: MCP_RESOURCE,
  });

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    grant_type: "client_credentials",
    resource: MCP_RESOURCE,
    scope: "read:pages",
  });
  const token = await fetch(`${BASE_URL}/api/auth/oauth2/token`, {
    body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = (await token.json()) as { access_token?: string };
  expect(token.status, JSON.stringify(body)).toBe(200);
  expect(body.access_token).toBeTruthy();
  return body.access_token!;
}

function rpc(method: string, params?: unknown, id: number = 1) {
  return JSON.stringify({ id, jsonrpc: "2.0", method, params });
}

describe("mcp bearer transport (port of TestMCP_BearerProtectedEcho)", () => {
  beforeEach(async () => {
    overrideSecret("PORT", String(TEST_PORT));
    overrideSecret("BASE_URL", BASE_URL);
    overrideSecret("MCP_RESOURCE", MCP_RESOURCE);
    testDb = await prepareTestDatabase();
    app = buildApp();
    app.listen(TEST_PORT);
  });

  afterEach(async () => {
    await app?.stop?.();
    app = null;
    testDb = null;
    resetSecrets();
  });

  it("rejects unauthenticated calls with 401 + resource_metadata challenge", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      body: rpc("tools/call", {
        arguments: { message: "hi" },
        name: "echo",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "resource_metadata=",
    );
  });

  it("serves protected-resource metadata for discovery", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await fetch(`${BASE_URL}${path}`);
      expect(response.status).toBe(200);
      const metadata = (await response.json()) as {
        authorization_servers?: string[];
        resource?: string;
      };
      expect(metadata.resource).toBe(MCP_RESOURCE);
      expect(metadata.authorization_servers).toContain(BASE_URL);
    }
  });

  it("authorizes tools/call echo with a client_credentials token", async () => {
    const token = await mcpToken();
    const response = await fetch(`${BASE_URL}/mcp`, {
      body: rpc("tools/call", {
        arguments: { message: "hi" },
        name: "echo",
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Echo: hi");
  });

  it("lists all 11 tools over tools/list", async () => {
    const token = await mcpToken();
    const response = await fetch(`${BASE_URL}/mcp`, {
      body: rpc("tools/list"),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (body.result?.tools ?? []).map((tool) => tool.name);
    for (const want of [
      "list_pages",
      "get_page",
      "get_page_content",
      "render_page",
      "create_page",
      "upload_content",
      "edit_page",
      "delete_page",
      "get_public_page",
      "echo",
      "whoami",
    ]) {
      expect(names).toContain(want);
    }
  });
});
