---
title: Agent Integration Guide
description: Integrate pages with your coding agent via the MCP server
---

## Overview

pages provides a **Model Context Protocol (MCP) server** that allows AI coding agents to discover, create, edit, and manage your pages programmatically. This guide covers how to set up your agent to work with pages.

## What is the MCP Server?

The MCP server is a JSON-RPC endpoint (`/mcp`) that:

- Securely authenticates requests using **OAuth 2.1 bearer tokens**
- Provides **11 tools** for pages CRUD, content management, and rendering
- Advertises itself via standard `.well-known` metadata endpoints
- Integrates seamlessly with Claude, Anthropic's AI assistant

## Quick Start

### 1. Enable MCP in Your Agent

If using Claude, add pages as an MCP server in your Claude configuration:

```json
{
  "mcpServers": {
    "pages": {
      "url": "https://pages.rega.run/mcp",
      "protocol": "http"
    }
  }
}
```

Or in the Claude web app, go to **Settings → Developer** and add the server URL.

### 2. Authenticate

pages uses OAuth 2.1 `client_credentials` flow for machine-to-machine authentication:

```bash
curl -X POST https://pages.rega.run/api/auth/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "scope=read:pages" \
  -d "resource=https://pages.rega.run/mcp"
```

This returns an access token valid for **1 hour**:

```json
{
  "access_token": "eyJhbGciOiJFZERTQSIsImtpZCI6IjEifQ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read:pages"
}
```

### 3. Call MCP Tools

Pass the token as a Bearer token in the `Authorization` header:

```bash
curl -X POST https://pages.rega.run/mcp \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_pages",
      "arguments": {}
    }
  }'
```

## Available Tools

### Reading Pages

**`list_pages`** — List all pages you own

- **Input:** none
- **Output:** Array of page metadata (id, title, slug, created_at, is_public)
- **Example use case:** Agent syncs your pages to build a search index

**`get_page`** — Fetch a single page's metadata

- **Input:** `id` (UUID)
- **Output:** Page metadata with timestamps and visibility
- **Example use case:** Agent checks if a page exists before editing

**`get_page_content`** — Get a page's content source

- **Input:** `id` (UUID)
- **Output:** `content` (raw Markdown/HTML), `content_type`, `theme`
- **Example use case:** Agent reads your page source to refactor or improve it

**`render_page`** — Preview rendered HTML

- **Input:** `id` (UUID)
- **Output:** Full HTML document with theme styling applied
- **Example use case:** Agent validates the preview before publishing

**`get_public_page`** — Fetch a published page by slug (no auth required)

- **Input:** `slug` (string)
- **Output:** Page metadata and rendered HTML
- **Example use case:** Agent includes your published pages in context

### Creating & Editing Pages

**`create_page`** — Create a new page (metadata only)

- **Input:** `title`, `slug`, `theme`, `is_public`
- **Output:** Page id (UUID), created_at, updated_at
- **Note:** Content is uploaded separately via `upload_content`
- **Example use case:** Agent creates a shell page for you to fill in

**`upload_content`** — Set a page's content

- **Input:** `id`, `content` (Markdown or HTML), `content_type`
- **Output:** Updated page metadata
- **Example use case:** Agent writes content locally, uploads when ready

**`edit_page`** — Update page metadata (title, slug, theme, is_public)

- **Input:** `id`, any fields to update
- **Output:** Updated page metadata
- **Example use case:** Agent renames a page or toggles visibility

### Deleting & Discovery

**`delete_page`** — Permanently delete a page

- **Input:** `id` (UUID)
- **Output:** Confirmation
- **Example use case:** Agent cleans up draft pages

**`echo`** — Echo tool (debugging)

- **Input:** `message` (string)
- **Output:** "Echo: {message}"
- **Example use case:** Verify the agent is connected

**`whoami`** — Get your authenticated user identity

- **Input:** none
- **Output:** `user_id`, `email` from your session
- **Example use case:** Agent confirms who it's acting as

## Content Workflow

The separation of `create_page` and `upload_content` enables a **preview-before-publish** workflow:

```
Agent: create_page(title="My Post", slug="my-post")
       → Returns id: "550e8400-e29b-41d4-a716-446655440000"

Agent: upload_content(id, content="# My Post\n\nContent here...")
       → Page is now saved with content

Agent: render_page(id)
       → Agent previews the HTML locally

User: Reviews the preview in the Claude UI

User: "Publish it!"

Agent: edit_page(id, is_public=true)
       → Page is live at /p/my-post
```

## Themes

Pages support four built-in themes:

- `github-dark` (default)
- `github-light`
- `dracula`
- `nord`

Pass `theme` when creating a page or via `edit_page` to change it.

## Content Types

- `markdown` (default) — GitHub Flavored Markdown with tables, syntax highlighting, mermaid diagrams
- `html` — Raw HTML (you control the styling)

## Error Handling

If a request fails (e.g., missing authentication), the server responds with:

```json
{
  "status": 401,
  "error": "Unauthorized",
  "message": "Missing or invalid Bearer token"
}
```

**WWW-Authenticate Header:** The response includes a link to the protected-resource metadata endpoint so your agent can discover how to re-authenticate:

```
WWW-Authenticate: Bearer resource_metadata="https://pages.rega.run/.well-known/oauth-protected-resource/mcp"
```

## Creating an OAuth Client

To get `client_id` and `client_secret`, use the API endpoint:

```bash
curl -X POST https://pages.rega.run/api/oauth2/client \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My Coding Agent",
    "redirect_uris": ["http://localhost:8000/callback"]
  }'
```

The response includes your `client_id` and `client_secret`. Save them securely — the secret is only shown once.

An admin dashboard for managing integrations is coming soon.

## Example: Claude Integration

### 1. Get Credentials

Create an OAuth client (see above) and save:

```
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
```

### 2. Configure Claude

Add to your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "pages": {
      "env": {
        "CLIENT_ID": "your-client-id",
        "CLIENT_SECRET": "your-client-secret",
        "PAGES_URL": "https://pages.rega.run"
      },
      "command": "node",
      "args": ["mcp-server-pages.js"]
    }
  }
}
```

### 3. Use from Claude

```
You: "Create a new page called 'My Project' with some initial content"

Claude: I'll create a page for you.
→ Calls create_page(title="My Project", slug="my-project")
→ Calls upload_content(id, content="# My Project\n\nInitial content...")
→ Calls render_page(id) to preview

Claude: I've created your page and here's the preview:
[Shows HTML preview of the page]

You: "Make the title bigger and add more details"

Claude: I'll update the content.
→ Calls get_page_content(id) to read current content
→ Modifies and calls upload_content(id, updated_content)
→ Calls render_page(id) to show the new preview
```

## Best Practices

### For Agents

1. **Always call `render_page` after uploading content** — let the user preview before publishing
2. **Use `get_page` before editing** — verify the page exists and get current metadata
3. **Set `is_public=false` by default** — users should explicitly publish
4. **Offer theme selection** — let users choose their preferred theme
5. **Handle 401 errors gracefully** — refresh the token and retry

### For Users

1. **Rotate client secrets regularly** — go to Integrations and regenerate
2. **Limit agent permissions** — consider separate clients for different agents
3. **Review agent actions** — always preview before publishing
4. **Use meaningful slugs** — they appear in the public URL `/p/slug`

## Troubleshooting

### "401 Unauthorized"

- Check that your access token is in the `Authorization: Bearer` header
- Verify the token hasn't expired (they last 1 hour)
- Regenerate a new token with the `/oauth2/token` endpoint

### "404 Not Found" for a Page

- Verify the page `id` is correct (UUIDs are case-sensitive)
- Check that you own the page (it was created with your account)
- For public pages, use `get_public_page` with the `slug` instead

### "403 Forbidden" on Edit/Delete

- Only page owners can edit or delete their own pages
- If you're acting as an agent, verify the OAuth client is tied to your account

### Agent Not Discovering the Server

- Ensure pages is running (`go run . migrate && go run .` in `apps/pages/server/`)
- Check the MCP server URL is correct in your agent config
- Verify the agent can reach the `.well-known/oauth-protected-resource` endpoint

## API Reference

For complete API documentation, visit `/reference` on your pages server (e.g., `https://pages.rega.run/reference`). The interactive Scalar docs include request/response examples and live testing.

## What's Next?

- Explore the **[Writing Content](/docs/01-writing-content)** guide for Markdown tips
- Learn about **[Publishing](/docs/02-publishing)** workflows
- Check the **[Getting Started](/docs/00-getting-started)** tutorial if you're new to pages
