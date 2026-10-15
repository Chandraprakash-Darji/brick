import { Schema } from "effect";
import { Tool } from "effect/ai";

import { HttpApi, HttpApiGroup } from "effect/http-api";
import {
  action,
  Unauthorized,
  NotFound,
  Conflict,
  InternalServerError,
} from "@brickkit/core/contracts";
import { crudContract } from "@brickkit/crud";
import { pagesTable } from "./services/pages/page/model";
export const ThemeSchema = Schema.Literals([
  "github-dark",
  "github-light",
  "dracula",
  "nord",
]);
export const ContentTypeSchema = Schema.Literals(["markdown", "html"]);
export const PageSchema = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  content: Schema.String,
  contentType: ContentTypeSchema,
  theme: ThemeSchema,
  isPublic: Schema.Boolean,
  userId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export const PageMetaSchema = PageSchema.mapFields(
  ({ content: _content, ...fields }) => fields,
);
export const pageContract = crudContract({
  name: "page",
  path: "/api/pages/page",
  table: pagesTable,
  id: "id",
  errors: [Unauthorized],
  limits: { default: 20, max: 100 },
  fields: {
    id: { read: true, filter: ["eq", "in"] },
    slug: {
      read: true,
      create: true,
      update: true,
      filter: ["eq", "contains"],
      sort: true,
    },
    title: {
      read: true,
      create: true,
      update: true,
      filter: ["eq", "contains"],
      sort: true,
    },
    content: { read: true, create: true, update: true },
    contentType: { read: true, create: true, update: true },
    theme: { read: true, create: true, update: true },
    isPublic: { read: true, create: true, update: true, filter: ["eq"] },
    userId: { read: true },
    createdAt: { read: true, sort: true },
    updatedAt: { read: true, sort: true },
  },
});
const errors = [Unauthorized, NotFound, Conflict, InternalServerError] as const;
const toolMetadata = {
  list_pages: {
    title: "List Pages",
    description:
      "List all pages owned by the authenticated user. Returns an array of page metadata objects with id, title, slug, contentType, theme, isPublic, userId, createdAt, and updatedAt. **No content body is included.**",
    tool: {
      readOnly: true,
    },
  },
  get_page: {
    title: "View Page",
    description:
      "Get a single page's metadata (id, title, slug, contentType, theme, isPublic, createdAt, updatedAt). Does NOT include the page body — use get_page_content or render_page for that.",
    tool: {
      readOnly: true,
    },
  },
  get_page_content: {
    title: "View Page Content",
    description:
      "Get the raw source content of a page. Returns the original markdown or HTML source as a plain text string — NOT rendered. Use render_page to get a previewable HTML document. The returned content can be used with tools that write files (like VS Code's filesystem tools) for local editing before uploading back.",
    tool: {
      readOnly: true,
    },
  },
  render_page: {
    title: "Render Page",
    description:
      "Render a page to a complete, self-contained HTML document. The returned HTML inlines all theme CSS so it renders correctly without external resources. Save this output to a .html file locally to preview how the page will look when published. Supports GitHub-Flavored Markdown (tables, strikethrough, task lists, auto-heading IDs), Mermaid diagrams, and auto-generated table of contents.",
    tool: {
      readOnly: true,
    },
  },
  create_page: {
    title: "Create Page",
    description:
      "Create a new page with metadata (title, slug, contentType, theme, isPublic). The page is created with empty content — use upload_content to set the body after optionally previewing the rendered HTML with render_page. The slug must be unique across all pages.",
    tool: {
      idempotent: true,
    },
  },
  edit_page: {
    title: "Edit Page",
    description:
      "Edit page metadata (title, slug, theme, isPublic, contentType). Only the fields you provide will be updated — missing fields keep their current values. Does NOT touch the page content body — use upload_content for that.",
    tool: {},
  },
  upload_content: {
    title: "Upload Page Content",
    description:
      "Upload (or replace) the full content body of a page. The content is raw markdown or HTML source, NOT a rendered document. After uploading you can call render_page to verify it looks correct, or use get_page_content to read it back. Prefer writing the content to a file locally first and then uploading it here — this lets you keep a local copy and use render_page for preview before committing.",
    tool: {
      destructive: false,
    },
  },
  delete_page: {
    title: "Delete Page",
    description:
      "Permanently delete a page and all its content by ID. This action cannot be undone. The page must be owned by the authenticated user.",
    tool: {
      destructive: true,
    },
  },
  get_public_page: {
    title: "View Public Page",
    description:
      "Get a public page by its slug. No authentication required. Returns page metadata (id, title, slug, contentType, theme, isPublic, createdAt, updatedAt). Only works for pages with isPublic=true. For private pages, the authenticated user must use get_page instead.",
    tool: {
      readOnly: true,
    },
  },
  echo: {
    title: "Echo Message",
    description:
      "Connectivity test — echoes back the message you send. Returns the message prefixed with 'Echo:' and the authenticated user's ID.",
    tool: {},
  },
  whoami: {
    title: "View Connected Account",
    description:
      "Returns the authenticated subject (user ID) of the current bearer token.",
    tool: {
      readOnly: true,
    },
  },
} as const;
const tool = <
  const N extends keyof typeof toolMetadata,
  I extends Schema.Top,
  O extends Schema.Top,
>(
  name: N,
  input: I,
  output: O,
) =>
  action(name, `/api/pages/${name}`, {
    input,
    output,
    errors,
    mcp: true,
    ...toolMetadata[name],
  });
const id = Schema.Struct({ id: Schema.String });
const metadata = {
  title: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  ),
  slug: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  ),
  contentType: Schema.optionalKey(ContentTypeSchema),
  theme: Schema.optionalKey(ThemeSchema),
  isPublic: Schema.optionalKey(Schema.Boolean),
};
export const tools = {
  list_pages: tool(
    "list_pages",
    Tool.EmptyParams,
    Schema.Array(PageMetaSchema),
  ),
  get_page: tool("get_page", id, PageMetaSchema),
  get_page_content: tool("get_page_content", id, Schema.String),
  render_page: tool("render_page", id, Schema.String),
  create_page: tool(
    "create_page",
    Schema.Struct({
      ...metadata,
      title: Schema.String.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(500),
      ),
      slug: Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/)),
    }),
    PageMetaSchema,
  ),
  edit_page: tool(
    "edit_page",
    Schema.Struct({ id: Schema.String, ...metadata }),
    PageMetaSchema,
  ),
  upload_content: tool(
    "upload_content",
    Schema.Struct({ id: Schema.String, content: Schema.String }),
    Schema.String,
  ),
  delete_page: tool("delete_page", id, Schema.String),
  get_public_page: tool(
    "get_public_page",
    Schema.Struct({ slug: Schema.String }),
    PageMetaSchema,
  ),
  echo: tool("echo", Schema.Struct({ message: Schema.String }), Schema.String),
  whoami: tool("whoami", Tool.EmptyParams, Schema.String),
};
const group = HttpApiGroup.make("pages").add(
  pageContract.actions["page.list"].endpoint,
  pageContract.actions["page.findOne"].endpoint,
  pageContract.actions["page.get"].endpoint,
  pageContract.actions["page.create"].endpoint,
  pageContract.actions["page.update"].endpoint,
  pageContract.actions["page.delete"].endpoint,
  pageContract.actions["page.count"].endpoint,
  pageContract.actions["page.exists"].endpoint,
  tools.list_pages.endpoint,
  tools.get_page.endpoint,
  tools.get_page_content.endpoint,
  tools.render_page.endpoint,
  tools.create_page.endpoint,
  tools.edit_page.endpoint,
  tools.upload_content.endpoint,
  tools.delete_page.endpoint,
  tools.get_public_page.endpoint,
  tools.echo.endpoint,
  tools.whoami.endpoint,
);
export const Api = HttpApi.make("brick").add(group);

type PageActions = typeof pageContract.actions;
/** Request payloads, derived from the contract so client and server cannot drift. */
export type PageCreateInput =
  PageActions["page.create"]["endpoint"]["~Payload"]["Type"];
export type PageUpdateInput =
  PageActions["page.update"]["endpoint"]["~Payload"]["Type"];
export type PageUpdateRequest = {
  readonly id: string;
  readonly data: PageUpdateInput;
};
