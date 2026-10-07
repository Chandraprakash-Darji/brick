import { Link, createFileRoute } from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"
import * as React from "react"

import { InstallCommand } from "@/components/install-command"
import { buttonVariants } from "@/components/ui/button"
import { site } from "@/lib/site"
import { cn } from "@/lib/utils"
import { SourceCode } from "@/components/source-code"
import { HomeCapabilities } from "@/components/home-capabilities"
import usersSource from "../../../examples/showcase/src/services/users.ts?raw"
import mainSource from "../../../examples/showcase/src/main.ts?raw"
import serverSource from "../../../examples/showcase/src/server.ts?raw"
import { dataUrl, lastValue, type BenchmarkData } from "@/lib/benchmarks"
import localBenchmarks from "../../public/data/benchmarks-latest.json"

export const Route = createFileRoute("/")({
  component: Home,
})


const features = [
  {
    title: "Monomorphic Dispatch",
    text: "Call typed actions directly in process with the same validation and error handling used by HTTP routes.",
    link: "/docs/getting-started",
  },
  {
    title: "AOT Routing & Streaming",
    text: "Compile action handlers and resource plans ahead of request handling, and serve them through Elysia.",
    link: "/docs/resource-lifecycle",
  },
  {
    title: "Logical Monolith",
    text: "Single repository with shared schemas, full TypeScript type safety, and instant jump-to-definition across services.",
    link: "/docs/codegen",
  },
  {
    title: "Physical Microservices",
    text: "Expose services over HTTP using the same action definitions you invoke in process.",
    link: "/docs/brick-cli",
  },
  {
    title: "Better Auth & Drizzle",
    text: "First-class integration with Better Auth session security and Drizzle ORM pre-compiled query caching.",
    link: "/docs/access-control",
  },
  {
    title: "Continuous Benchmarking",
    text: "Every push to main measures throughput, latency, net heap changes and process RSS on macOS, Linux and Windows.",
    link: "/docs/benchmarking",
  },
]

const kinds = [
  { id: "monolith", label: "Logical Monolith" },
  { id: "microservice", label: "HTTP Service" },
] as const

type Kind = (typeof kinds)[number]["id"]

const codeSamples = {
  monolith: {
    serviceFile: "src/services/users.ts",
    serviceCode: usersSource.trim(),
    sideFile: "src/main.ts",
    sideDesc: "Invoke the same typed action directly in process. These files are the runnable examples/showcase source in this repository.",
    sideCode: mainSource.trim(),
  },
  microservice: {
    serviceFile: "src/server.ts",
    serviceCode: serverSource.trim(),
    sideFile: "src/server.ts",
    sideDesc: "Expose the users service over HTTP. Run bun run --cwd examples/showcase serve, then request /api/users/getUser?id=usr_42.",
    sideCode: serverSource.trim(),
  },
}

function Home() {
  const [kind, setKind] = React.useState<Kind>("monolith")
  const activeCode = codeSamples[kind]
  const [benchmarks, setBenchmarks] = React.useState<BenchmarkData>(localBenchmarks as BenchmarkData)
  React.useEffect(() => {
    const controller = new AbortController()
    fetch(dataUrl, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.ok) setBenchmarks(await response.json() as BenchmarkData)
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  const measured = benchmarks.series.darwin ?? benchmarks.series.linux ?? {}
  const value = (suite: string, name: string, unit: string) => lastValue(measured[suite]?.[name]?.[unit] ?? [])
  const stats = [
    { label: "HTTP throughput", value: value("compiler", "sync", "req/s"), unit: "req/s" },
    { label: "Cold startup", value: value("footprint", "cold-start", "ms"), unit: "ms" },
    { label: "Idle CPU · 5s", value: value("footprint", "idle-cpu", "ms"), unit: "ms CPU" },
    { label: "Server bundle", value: value("bundle", "server-bundle", "B"), unit: "KiB" },
  ]

  return (
    <main>
      <section className="grid grid-cols-1 gap-12 py-16 md:py-24 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div className="min-w-0">
          <p className="label flex items-center gap-3"><span className="size-2 bg-gopher" /> TypeScript in. Backend out.</p>
          <h1 className="mt-7 text-5xl leading-[0.98] font-semibold tracking-[-0.055em] sm:text-6xl xl:text-7xl">
            Build with types.<br />
            <span className="text-gopher-ink">Ship with speed.</span>
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">
            Your actions, resources, and rules. Brick compiles them into a backend ready to run on Bun.
            One codebase, from direct calls to HTTP services.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/docs/$" params={{ _splat: "getting-started" }} className={buttonVariants({ size: "lg", className: "h-12 rounded-none px-6" })}>
              Start building <ArrowRightIcon className="ml-3 size-4" />
            </Link>
            <Link to="/benchmarks" className="inline-flex h-12 items-center gap-3 px-3 text-sm font-medium hover:text-gopher-ink">
              See the numbers <ArrowRightIcon className="size-4" />
            </Link>
          </div>
          <InstallCommand className="mt-6 rounded-none" command="bun add @elregaldo/core @elregaldo/cli" />
          <a href={`${site.repo}/releases`} target="_blank" rel="noreferrer" className="label mt-5 block hover:text-foreground">
            v{site.version} / Open source / Built for Bun
          </a>
        </div>
        <div className="brick-stack min-w-0" aria-label="Brick compiles TypeScript definitions into execution plans that run on Bun">
          <div className="brick-layer mr-8">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">01 / DEFINE</span>
            <p className="mt-2 text-xl font-semibold tracking-tight">TypeScript definitions</p>
            <p className="mt-1 text-sm text-muted-foreground">Actions. Resources. Your rules.</p>
          </div>
          <div className="brick-layer">
            <span className="font-mono text-[10px] tracking-widest">02 / COMPILE</span>
            <p className="mt-2 text-xl font-semibold tracking-tight">Resolved execution plans</p>
            <p className="mt-1 text-sm">Routing, validation, and database queries.</p>
          </div>
          <div className="brick-layer">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">03 / RUN</span>
            <p className="mt-2 text-xl font-semibold tracking-tight">Your backend, on Bun</p>
            <p className="mt-1 text-sm text-muted-foreground">Direct calls or HTTP. Same definitions.</p>
          </div>
          <p className="label mt-8 text-center">Less work on every request.</p>
        </div>
      </section>

      <section className="brick-stats py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="label">01 / Measured, not guessed</p>
          <Link to="/benchmarks" className="font-mono text-[11px] text-[#f3ab78] hover:underline">Explore benchmarks ↗</Link>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-y-6 md:grid-cols-4">
          {stats.map((stat, i) => (
            <div key={stat.label} className={cn("brick-stat min-w-0 border-l px-4", i === 0 && "border-l-0 pl-0")}>
              <dt className="label">{stat.label}</dt>
              <dd className="mt-3 text-3xl font-medium tracking-tight tabular-nums sm:text-4xl">
                {(stat.value === undefined ? undefined : stat.unit === "KiB" ? stat.value / 1024 : stat.value)?.toLocaleString("en-US", { maximumFractionDigits: stat.unit === "req/s" ? 0 : 1 }) ?? "—"}
                <span className="mt-1 block font-mono text-xs font-normal text-[#c6beb5]">{stat.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-xs text-[#c6beb5]">Fixed JSON action throughput · minimal server startup and idle CPU · minified server bundle. Full methodology in benchmarks.</p>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 pt-14">
        <div><p className="label">02 / The developer surface</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Small definitions. Real backends.</h2></div>
        <p className="max-w-xs text-sm leading-6 text-muted-foreground">These are the actual runnable files in our repository.</p>
      </div>

      <div className="border bg-code">
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
            <figcaption className="border-b px-4 py-3 font-mono text-xs text-muted-foreground sm:px-6">{activeCode.serviceFile}</figcaption>
            <div className="overflow-x-auto px-4 py-5 sm:px-6">
              <SourceCode key={activeCode.serviceCode} code={activeCode.serviceCode} />
            </div>
          </figure>
          {kind === "monolith" ? (
            <figure className="flex min-w-0 flex-col border-t lg:border-t-0">
              <figcaption className="border-b px-4 py-3 font-mono text-xs text-muted-foreground sm:px-6">{activeCode.sideFile}</figcaption>
              <div className="overflow-x-auto px-4 py-5 sm:px-6">
                <SourceCode key={activeCode.sideCode} code={activeCode.sideCode} />
              </div>
              <p className="mt-auto border-t px-4 py-4 text-sm leading-6 text-muted-foreground sm:px-6">{activeCode.sideDesc}</p>
            </figure>
          ) : (
            <div className="flex min-w-0 flex-col border-t lg:border-t-0">
              <p className="label border-b px-4 py-3 sm:px-6">Zero-Refactor Deployment</p>
              <div className="space-y-4 px-4 py-5 text-sm leading-6 text-muted-foreground sm:px-6">
                <p>Use the same typed service definitions for direct calls and HTTP routes. The runnable example exposes the users service on port 3000.</p>
                <p>Request /api/users/getUser?id=usr_42 to call the action over HTTP.</p>
              </div>
              <figure className="mt-auto border-t">
                <figcaption className="label border-b px-4 py-3 sm:px-6">Run the example</figcaption>
                <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.7] sm:px-6">
                  <span className="text-gopher-ink select-none">$ </span>{"bun run --cwd examples/showcase serve\n"}
                  <span className="text-gopher-ink select-none">$ </span>{"curl 'http://localhost:3000/api/users/getUser?id=usr_42'"}
                </pre>
              </figure>
            </div>
          )}
        </div>
      </div>

      <div className="pb-6 pt-14"><p className="label">03 / Built to fit together</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">The pieces your backend needs.</h2></div>
      <ul className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <li key={feature.title} className="brick-feature border bg-card">
            <Link to={feature.link} className="group flex h-full flex-col p-6">
              <span className="mb-8 font-mono text-xs text-gopher-ink">/{String(i + 1).padStart(2, "0")}</span>
              <h3 className="flex items-center justify-between font-semibold tracking-tight">
                {feature.title}
                <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{feature.text}</p>
            </Link>
          </li>
        ))}
      </ul>
      <HomeCapabilities />
    </main>
  )
}
