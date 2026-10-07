import * as React from "react"
import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, CheckIcon, DatabaseIcon, FileJsonIcon, ShieldCheckIcon, TerminalIcon } from "lucide-react"
import { SourceCode } from "@/components/source-code"
import { buttonVariants } from "@/components/ui/button"
import { InstallCommand } from "@/components/install-command"
import { cn } from "@/lib/utils"
import extensionSource from "../../../examples/extensions/src/extensions/comments/index.ts?raw"
import appSource from "../../../examples/extensions/src/app.ts?raw"

// Exact excerpts from the runnable extension, rather than illustrative APIs.
const resourceCode = extensionSource.slice(extensionSource.indexOf("  const comments ="), extensionSource.indexOf("  const countComments =")).trim()
const actionCode = extensionSource.slice(extensionSource.indexOf("  const countComments ="), extensionSource.indexOf("  return { comments,")).trim()
const routes = [
  ["GET", "/api/comment", "List, filter, paginate"],
  ["GET", "/api/comment/:id", "Read one record"],
  ["POST", "/api/comment", "Create a record"],
  ["PATCH", "/api/comment/:id", "Update a record"],
  ["PUT", "/api/comment/:id", "Update a record"],
  ["DELETE", "/api/comment/:id", "Delete a record"],
]

function DocsLink({ slug, children }: { slug: string; children: React.ReactNode }) {
  return <Link to="/docs/$" params={{ _splat: slug }} className="mt-6 inline-flex items-center gap-3 text-sm font-medium text-gopher-ink hover:underline underline-offset-4">{children}<ArrowRightIcon className="size-4" /></Link>
}

function CodePanel({ title, code }: { title: string; code: string }) {
  return <figure className="min-w-0 border bg-code"><figcaption className="break-all border-b px-5 py-3 font-mono text-xs text-muted-foreground">{title}</figcaption><div className="max-h-[440px] overflow-auto p-5"><SourceCode key={code} code={code} /></div></figure>
}

export function HomeCapabilities() {
  const [example, setExample] = React.useState<"resource" | "action">("resource")
  return <>
    <section id="resources" className="border-t py-16 md:py-20">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="label">04 / Resources, without the repetition</p>
          <h2 className="mt-4 max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">A table becomes an API.<br /><span className="text-gopher-ink">Your rules come with it.</span></h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">Define a Drizzle table and register a resource. Brick supplies CRUD routes, list filters, pagination, and typed hooks. Add custom actions for the work that goes beyond CRUD.</p>
          <div className="mt-7 divide-y border">
            {routes.map(([method, path, description]) => <div key={method + path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"><span className="w-14 font-mono text-[11px] font-medium text-gopher-ink">{method}</span><code className="text-xs">{path}</code><span className="ml-auto text-xs text-muted-foreground">{description}</span></div>)}
          </div>
          <DocsLink slug="resources">Explore resources</DocsLink>
        </div>
        <div className="min-w-0">
          <div className="mb-4 flex gap-2" role="tablist" aria-label="Resource or custom action example">
            {(["resource", "action"] as const).map(value => <button type="button" role="tab" id={`feature-tab-${value}`} aria-selected={example === value} aria-controls="feature-code" key={value} onClick={() => setExample(value)} className={cn("border px-4 py-2 font-mono text-xs transition-colors", example === value ? "border-gopher-ink bg-code text-gopher-ink" : "text-muted-foreground hover:text-foreground")}>{value === "resource" ? "Resource + hooks" : "Custom action"}</button>)}
          </div>
          <div role="tabpanel" id="feature-code" aria-labelledby={`feature-tab-${example}`}><CodePanel title="examples/extensions/src/extensions/comments/index.ts · excerpt" code={example === "resource" ? resourceCode : actionCode} /></div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Runnable comments extension. This is the source that serves the routes shown here.</p>
        </div>
      </div>
    </section>

    <section id="validation" className="brick-section-inset border-t bg-code py-16 md:py-20">
      <p className="label">05 / Types that do work</p>
      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div><h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">One definition.<br />Fewer places to drift.</h2><p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">TypeBox schemas supply action types and runtime validation. Drizzle tables supply row types and resource shapes. OpenAPI describes the same registered API.</p><DocsLink slug="codegen">Follow the types</DocsLink></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[["01", "Inputs", "Validate request values before running the action."], ["02", "Handlers", "Infer input and output types from the declared schemas."], ["03", "Resources", "Use the table's row and insert types in resource hooks."], ["04", "API contracts", "Generate OpenAPI from registered services and schemas."]].map(([number, title, text]) => <div key={title} className="border bg-background p-5"><span className="font-mono text-xs text-gopher-ink">/{number}</span><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></div>)}
        </div>
      </div>
    </section>

    <section id="access-control" className="grid grid-cols-1 gap-10 border-t py-16 md:py-20 lg:grid-cols-2 lg:items-center">
      <div><p className="label">06 / Your application, your policies</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Put access rules<br />next to the work.</h2><p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">Resolve a session into service context, authorize custom actions, and scope resource rows to their owner. Connect Better Auth through its session API or bring your own session provider.</p><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Authentication is explicit: configure sign-in checks for protected CRUD routes. Owner scoping complements those checks.</p><DocsLink slug="access-control">Configure access control</DocsLink></div>
      <ol className="space-y-3">
        {[["Context", "Resolve the user and session from the incoming request."], ["Authorization", "Allow or reject a custom action before its handler runs."], ["Ownership", "Scope resource access using the configured owner field."]].map(([title, text], index) => <li className="flex items-start gap-4 border bg-card p-5" key={title}><ShieldCheckIcon className="mt-1 size-5 shrink-0 text-gopher-ink" /><div><p className="font-mono text-[10px] text-muted-foreground">0{index + 1} / POLICY</p><h3 className="mt-1 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></div></li>)}
      </ol>
    </section>

    <section id="databases" className="border-t py-16 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6"><div><p className="label">07 / Real data, familiar tools</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Drizzle at the foundation.</h2></div><p className="max-w-md text-base leading-7 text-muted-foreground">Keep your SQL, table definitions, and migrations. Brick adds services and resources around them.</p></div>
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {[["SQLite", "Start locally with Bun's native SQLite driver. Use an in-memory database for examples or a file-backed database for persistence.", "Bun-native driver", "In-memory or file-backed"], ["PostgreSQL", "Connect a PostgreSQL database with a URL and Drizzle tables. Keep production schema changes in your migration workflow.", "Postgres.js driver", "Drizzle table definitions"]].map(([title, text, first, second]) => <article key={title} className="border bg-card p-6 sm:p-8"><DatabaseIcon className="size-6 text-gopher-ink" /><h3 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h3><p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">{text}</p><ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-xs">{[first, second].map(item => <li key={item} className="flex items-center gap-2"><CheckIcon className="size-3.5 text-gopher-ink" />{item}</li>)}</ul></article>)}
      </div><DocsLink slug="migrations">Read the database guide</DocsLink>
    </section>

    <section id="extensions" className="brick-section-inset grid grid-cols-1 gap-10 border-t bg-code py-16 md:py-20 lg:grid-cols-2 lg:items-start">
      <div className="min-w-0"><p className="label">08 / Build once. Bring it along.</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Extensions are<br />just TypeScript.</h2><p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">Package a table, resource, hooks, and custom actions as a reusable module. Import it into a service and register it before building the server.</p><p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">The comments example is runnable today. Use the same pattern for audit trails, reactions, or application-specific workflows.</p><div className="mt-6 flex flex-wrap gap-2">{["Comments", "Audit trails", "Resource hooks", "Custom actions"].map(item => <span key={item} className="border bg-background px-3 py-1.5 font-mono text-[11px]">{item}</span>)}</div><DocsLink slug="plugins/build-plugin">Build your first extension</DocsLink></div>
      <CodePanel title="examples/extensions/src/app.ts" code={appSource.trim()} />
    </section>

    <section id="endpoints" className="border-t py-16 md:py-20">
      <p className="label">09 / Beyond the JSON API</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Keep the response in your hands.</h2><p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">Use raw endpoints when an action's JSON response is not the right interface. Handlers receive the request, parameters, headers, database, and logger.</p>
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">{[["HTML surfaces", "Render a public page and set its content type in your handler."], ["Webhook handlers", "Read the original request and apply your provider's signature checks."], ["Custom responses", "Return a Response when you need control over headers, status, or a streaming body."]].map(([title, text]) => <article key={title} className="border bg-card p-6"><h3 className="text-lg font-semibold tracking-tight">{title}</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">{text}</p></article>)}</div><DocsLink slug="plugins">Explore the endpoint API</DocsLink>
    </section>

    <section id="tooling" className="border-t py-16 md:py-20">
      <p className="label">10 / From definitions to a running service</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Inspect it. Document it. Compile it.</h2>
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="border bg-card p-6"><TerminalIcon className="size-6 text-gopher-ink" /><h3 className="mt-5 text-xl font-semibold tracking-tight">A compiler you can inspect</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">Build emits the route handlers, Brick IR, and a bundled Bun server. Your action callbacks remain TypeScript-authored application logic.</p><DocsLink slug="brick-cli/build">See the compiler output</DocsLink></article>
        <article className="border bg-card p-6"><FileJsonIcon className="size-6 text-gopher-ink" /><h3 className="mt-5 text-xl font-semibold tracking-tight">An API that documents itself</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">Serve generated OpenAPI with Scalar and Swagger views. Export a spec for client tooling or inspect the registered service architecture.</p><DocsLink slug="openapi">Explore API documentation</DocsLink></article>
        <article className="border bg-card p-6"><CheckIcon className="size-6 text-gopher-ink" /><h3 className="mt-5 text-xl font-semibold tracking-tight">Exercise the actual routes</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">The extension demo sends requests through compiled routes and checks CRUD, validation errors, and direct action calls.</p><DocsLink slug="plugins/build-plugin">Run the verified example</DocsLink></article>
      </div>
    </section>

    <section id="ecosystem" className="border-t py-12">
      <p className="label">11 / Built on tools you already know</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Familiar tools. One backend.</h2><div className="mt-7 flex flex-wrap gap-x-8 gap-y-4 text-xl font-semibold tracking-tight sm:text-2xl">{["TypeScript", "Bun", "Elysia", "TypeBox", "Drizzle"].map(tool => <span key={tool}>{tool}<span className="ml-2 text-gopher-ink">/</span></span>)}</div><p className="mt-5 text-sm text-muted-foreground">A backend authoring layer over a familiar runtime and database toolkit.</p>
    </section>

    <section className="brick-section-inset mb-16 border-y bg-code py-12">
      <p className="label">Your next backend starts here</p><div className="mt-4 flex flex-wrap items-end justify-between gap-8"><h2 className="max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">Write the definitions.<br /><span className="text-gopher-ink">Make something real.</span></h2><Link to="/docs/$" params={{ _splat: "getting-started" }} className={buttonVariants({ size: "lg", className: "h-12 rounded-none px-6" })}>Start with the guide<ArrowRightIcon className="ml-3 size-4" /></Link></div><InstallCommand className="mt-8 rounded-none" /></section>
  </>
}
