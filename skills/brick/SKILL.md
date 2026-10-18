---
name: brick
description: Build and modify TypeScript backends with Brick on Bun, including services, actions, resources, CRUD, typed clients, and MCP tools. Use when a project uses @brickkit/core, @brickkit/crud, or @brickkit/cli.
---

# Brick projects

Read the project's package scripts and existing service definitions before changing code. Use the installed Brick version as the API reference.

## Find documentation

Fetch `https://www.brickkit.dev/llms.txt` and follow the relevant markdown links. Use `https://www.brickkit.dev/llms-full.txt` when you need the complete reference. Each docs page also has a `.md` URL, and accepts `Accept: text/markdown`.

Use `/docs/quickstart.md` for a runnable starter and `/docs/tutorial.md` for an end-to-end REST API. For existing projects, fetch the relevant guides:

- `/docs/services-and-actions.md`, `/docs/context.md`, and `/docs/validation-and-errors.md` for actions and execution context.
- `/docs/resources.md`, `/docs/access-control.md`, `/docs/hooks.md`, and `/docs/relations.md` for CRUD and database changes.
- `/docs/typed-client.md` for browser clients and `/docs/tools-and-mcp.md` for MCP tools.
- `/docs/reference/cheatsheet.md` for symbols and `/docs/brick-cli/info.md` for architecture exports.

If the hosted docs differ from the installed version, inspect the package types and source.

## Follow Brick's definitions

- Use `defineService` and its `.action()`, `.resource()`, and `.tool()` methods. Define input and output schemas with `t` from `@brickkit/core`.
- Keep database tables in the service's database definition. Use `@brickkit/crud` for generated resource operations where the project already uses it. CRUD requires an explicit access policy; preserve its field and operation permissions.
- Put authorization in the action or tool definition and resource access rules. Use the project's context resolver for identity.
- Import definition modules before compiling the app, generating contracts, or exporting the global registry. Registration occurs when modules load.
- Tools register separately from HTTP actions. Set `http: true` or attach a tool with `.action(tool)` only when HTTP access is required.
- Use the generated typed-client contract for browser calls. Keep server modules out of browser imports.

## Inspect the application

A running Brick app exposes its registered architecture at `GET /_brick/services`. For an offline export, run `bunx brick info <entry>` with the project's app entry file. The CLI loads definitions before exporting mounted routes and resource access policies. Service options are included, so review configuration values before sharing the JSON.

An app can expose MCP through `createMcpRegistry` and `createMcpHandler`. Read its tool definitions and auth layer before calling tools. The documentation site does not provide a hosted MCP server.

Run the project's type checks and relevant tests after edits. Follow its scripts for schema migrations and contract generation.
