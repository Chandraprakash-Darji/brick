import { Link, createFileRoute } from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"
import * as React from "react"

import { InstallCommand } from "@/components/install-command"
import { buttonVariants } from "@/components/ui/button"
import { site } from "@/lib/site"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/")({
  component: Home,
})

const stats = [
  { value: "~38", unit: "ns", label: "Monomorphic dispatch" },
  { value: "~28", unit: "k req/s", label: "HTTP throughput" },
  { value: "~34", unit: "MB", label: "Idle memory (RSS)" },
  { value: "0", unit: "%", label: "CPU at idle" },
]

const features = [
  {
    title: "Monomorphic Dispatch",
    text: "Zero-overhead direct action routing with monomorphic call sites in dev and single-process monolithic deployment.",
    link: "/benchmarks#micro",
  },
  {
    title: "AOT Routing & Streaming",
    text: "Elysia Ahead-Of-Time compiled route graph with bounded backpressure streaming and zero-copy JSON buffers.",
    link: "/benchmarks#http",
  },
  {
    title: "Logical Monolith",
    text: "Single repository with shared schemas, full TypeScript type safety, and instant jump-to-definition across services.",
    link: "/benchmarks#prepared",
  },
  {
    title: "Physical Microservices",
    text: "Deploy individual services or domain modules as isolated microservice containers with zero code restructuring.",
    link: "/benchmarks#batch",
  },
  {
    title: "Better Auth & Drizzle",
    text: "First-class integration with Better Auth session security and Drizzle ORM pre-compiled query caching.",
    link: "/benchmarks#startup",
  },
  {
    title: "Continuous Benchmarking",
    text: "Every commit measured across macOS, Linux, and Windows runners for latency, memory, and allocations.",
    link: "/benchmarks",
  },
]

const kinds = [
  { id: "monolith", label: "Logical Monolith" },
  { id: "microservice", label: "Physical Microservice" },
] as const

type Kind = (typeof kinds)[number]["id"]

const codeSamples = {
  monolith: {
    serviceFile: "src/services/users.ts",
    serviceCode: `import { defineAction } from "@brick/core"
import { z } from "zod"

export const getUser = defineAction({
  input: z.object({ id: z.string() }),
  async handler({ input, ctx }) {
    return ctx.db.users.findById(input.id)
  },
})

// Direct in-process invocation: ~38ns, zero HTTP overhead
const user = await getUser({ id: "usr_42" })`,
    sideFile: "src/main.ts",
    sideDesc: "./brick generates type-safe clients directly from actions, with full inference and zero runtime wrappers.",
    sideCode: `import { createClient } from "@brick/client"
import type { AppRouter } from "./server"

const client = createClient<AppRouter>({
  baseUrl: "https://api.brick.dev",
})

// Fully typed client response with end-to-end schema validation
const user = await client.getUser({ id: "usr_42" })
console.log(user.name, user.role)`,
  },
  microservice: {
    serviceFile: "src/server.ts",
    serviceCode: `import { createServer } from "@brick/server"
import { getUser } from "./services/users"

// Physical deployment: Elysia AOT compilation & Better Auth
const app = createServer({
  actions: [getUser],
  auth: { provider: "better-auth" },
  database: { dialect: "sqlite", wal: true },
})

app.listen(3000, () => {
  console.log("Service listening at http://localhost:3000")
})`,
    sideFile: "Terminal",
    sideDesc: "Run individual microservices or composite monoliths using the same source code.",
    sideCode: `$ bun create brick-app my-service
$ cd my-service
$ bun run dev
[brick] compiled 14 actions in 12ms
[brick] server listening on http://localhost:3000`,
  },
}

function Home() {
  const [kind, setKind] = React.useState<Kind>("monolith")
  const activeCode = codeSamples[kind]

  return (
    <main>
      <section className="px-4 py-20 sm:px-10 md:py-28">
        <a
          href={`${site.repo}/releases`}
          target="_blank"
          rel="noreferrer"
          className="label inline-flex items-center gap-2 hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-gopher" />v{site.version} · macOS, Linux, Windows · Bun 1.2
        </a>
        <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-[-0.04em] sm:text-5xl md:text-6xl">
          High-throughput platform.
          <span className="block text-muted-foreground">Logical monolith, physical microservices.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
          Build TypeScript services as a single codebase with monomorphic dispatch in dev, split into independent microservices with AOT routing, Better Auth, and Drizzle ORM in production.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <InstallCommand command="bun create brick-app my-app" />
          <Link to="/benchmarks" className={buttonVariants({ size: "lg", className: "h-11 px-5" })}>
            View benchmarks <ArrowRightIcon className="ml-1 size-4" />
          </Link>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-px border-t bg-border md:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col-reverse justify-end gap-2 bg-background px-4 py-6 sm:px-10 sm:py-8">
            <dt className="label">{stat.label}</dt>
            <dd className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
              {stat.value}
              <span className="ml-1 text-base font-normal text-muted-foreground">{stat.unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t bg-code">
        <div role="tablist" aria-label="Kind of deployment" className="flex border-b">
          {kinds.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              id={`tab-${k.id}`}
              aria-selected={kind === k.id}
              aria-controls="code-panel"
              onClick={() => setKind(k.id)}
              className={cn(
                "label -mb-px border-r border-b border-b-transparent px-4 py-3 transition-colors hover:text-foreground sm:px-6 cursor-pointer",
                kind === k.id && "border-b-gopher bg-background text-foreground"
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="code-panel" aria-labelledby={`tab-${kind}`} className="grid lg:grid-cols-[1.3fr_1fr] lg:divide-x">
          <figure className="min-w-0">
            <figcaption className="label border-b px-4 py-3 sm:px-6">{activeCode.serviceFile}</figcaption>
            <div className="shiki overflow-x-auto px-4 py-5 sm:px-6">
              <pre className="font-mono text-[13px] leading-[1.7] text-foreground">
                <code>{activeCode.serviceCode}</code>
              </pre>
            </div>
          </figure>
          {kind === "monolith" ? (
            <figure className="flex min-w-0 flex-col border-t lg:border-t-0">
              <figcaption className="label border-b px-4 py-3 sm:px-6">{activeCode.sideFile}</figcaption>
              <div className="overflow-x-auto px-4 py-5 sm:px-6">
                <pre className="font-mono text-[13px] leading-[1.7] text-foreground">
                  <code>{activeCode.sideCode}</code>
                </pre>
              </div>
              <p className="mt-auto border-t px-4 py-4 text-sm leading-6 text-muted-foreground sm:px-6">
                {activeCode.sideDesc}
              </p>
            </figure>
          ) : (
            <div className="flex min-w-0 flex-col border-t lg:border-t-0">
              <p className="label border-b px-4 py-3 sm:px-6">Zero-Refactor Deployment</p>
              <div className="space-y-4 px-4 py-5 text-sm leading-6 text-muted-foreground sm:px-6">
                <p>
                  Deploy services either together in one binary or distributed across cloud instances. Brick handles
                  AOT routing, RPC deserialization, and authentication boundaries automatically.
                </p>
                <p>Cold boots in under 15ms with full route graph compilation and instant health checks.</p>
              </div>
              <figure className="mt-auto border-t">
                <figcaption className="label border-b px-4 py-3 sm:px-6">Start a project</figcaption>
                <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.7] sm:px-6">
                  <span className="text-gopher-ink select-none">$ </span>
                  {"bun create brick-app my-app\n"}
                  <span className="text-gopher-ink select-none">$ </span>
                  {"cd my-app && bun run dev"}
                </pre>
              </figure>
            </div>
          )}
        </div>
      </div>

      <ul className="grid gap-px border-t bg-border sm:grid-cols-2">
        {features.map((feature) => (
          <li key={feature.title} className="bg-background">
            <Link to={feature.link} className="group flex h-full flex-col px-4 py-8 transition-colors hover:bg-code sm:px-10">
              <h2 className="flex items-center justify-between font-semibold tracking-tight">
                {feature.title}
                <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{feature.text}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
