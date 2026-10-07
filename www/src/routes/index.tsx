import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import * as React from "react";

import { LogoMark } from "@/components/logo";
import { InstallCommand } from "@/components/install-command";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";
import { SourceCode } from "@/components/source-code";
import { HomeCapabilities } from "@/components/home-capabilities";
import usersSource from "../../../examples/showcase/src/services/users.ts?raw";
import mainSource from "../../../examples/showcase/src/main.ts?raw";
import serverSource from "../../../examples/showcase/src/server.ts?raw";
import { dataUrl, lastValue, type BenchmarkData } from "@/lib/benchmarks";

export const Route = createFileRoute("/")({
  component: Home,
});

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
];

const kinds = [
  { id: "monolith", label: "Logical Monolith" },
  { id: "microservice", label: "HTTP Service" },
] as const;

type Kind = (typeof kinds)[number]["id"];

const codeSamples = {
  monolith: {
    serviceFile: "src/services/users.ts",
    serviceCode: usersSource.trim(),
    sideFile: "src/main.ts",
    sideDesc:
      "Invoke the same typed action directly in process. These files are the runnable examples/showcase source in this repository.",
    sideCode: mainSource.trim(),
  },
  microservice: {
    serviceFile: "src/server.ts",
    serviceCode: serverSource.trim(),
    sideFile: "src/server.ts",
    sideDesc:
      "Expose the users service over HTTP. Run bun run --cwd examples/showcase serve, then request /api/users/getUser?id=usr_42.",
    sideCode: serverSource.trim(),
  },
};

function Home() {
  const [kind, setKind] = React.useState<Kind>("monolith");
  const activeCode = codeSamples[kind];
  const [benchmarks, setBenchmarks] = React.useState<BenchmarkData>();
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(dataUrl, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (response.ok)
          setBenchmarks((await response.json()) as BenchmarkData);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const measured = benchmarks?.series.darwin ?? benchmarks?.series.linux ?? {};
  const value = (suite: string, name: string, unit: string) =>
    lastValue(measured[suite]?.[name]?.[unit] ?? []);
  const stats = [
    {
      label: "HTTP throughput",
      value: value("compiler", "sync", "req/s"),
      unit: "req/s",
    },
    {
      label: "Cold startup",
      value: value("footprint", "cold-start", "ms"),
      unit: "ms",
    },
    {
      label: "Idle CPU · 5s",
      value: value("footprint", "idle-cpu", "ms"),
      unit: "ms CPU",
    },
    {
      label: "Server bundle",
      value: value("bundle", "server-bundle", "B"),
      unit: "KiB",
    },
  ];

  return (
    <main id="top" className="brick-landing">
      <section className="brick-hero">
        <a
          href={`${site.repo}/releases`}
          target="_blank"
          rel="noreferrer"
          className="hero-release"
        >
          <span /> BRICK v{site.version}{" "}
          <span className="hero-release-divider">/</span> OPEN SOURCE
        </a>
        <LogoMark className="hero-symbol" />
        <h1>
          Build your backend.
          <br />
          Keep your TypeScript.
        </h1>
        <p className="hero-caption">Small definitions. Production execution.</p>
        <p className="hero-description">
          Your actions, resources, and rules.
          <br className="hidden sm:block" /> Compiled into a backend ready to
          run on Bun.
        </p>
        <div className="hero-actions">
          <Link
            to="/docs/$"
            params={{ _splat: "getting-started" }}
            className="home-button home-button-primary"
          >
            Start building <ArrowRightIcon className="size-3.5" />
          </Link>
          <a
            href={site.repo}
            target="_blank"
            rel="noreferrer"
            className="home-button home-button-secondary"
          >
            Explore the source <ArrowRightIcon className="size-3.5" />
          </a>
        </div>
        <InstallCommand
          className="home-install"
          command="bun add @brickkit/core @brickkit/cli"
        />
        <a href="#definitions" className="hero-scroll">
          DEFINE / COMPILE / RUN <span>↓</span>
        </a>
      </section>

      <div id="definitions" className="home-section-heading">
        <div>
          <p className="label">01 / THE DEVELOPER SURFACE</p>
          <h2>
            One codebase.
            <br />
            Two ways to run.
          </h2>
        </div>
        <p className="section-description">
          Start with direct calls. Expose HTTP when you need it. The same typed
          definitions power both.
        </p>
      </div>

      <div className="brick-workbench">
        <div className="workbench-toolbar">
          <span className="window-controls" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>BRICK / APPLICATION WORKBENCH</span>
          <span className="workbench-status">
            <i /> READY TO RUN
          </span>
        </div>
        <div
          role="tablist"
          aria-label="Kind of deployment"
          className="workbench-tabs"
        >
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
                "workbench-tab",
                kind === k.id && "workbench-tab-active",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="code-panel"
          aria-labelledby={`tab-${kind}`}
          className="grid lg:grid-cols-[1.3fr_1fr] lg:divide-x"
        >
          <figure className="min-w-0">
            <figcaption className="border-b px-4 py-3 font-mono text-xs text-muted-foreground sm:px-6">
              {activeCode.serviceFile}
            </figcaption>
            <div className="overflow-x-auto px-4 py-5 sm:px-6">
              <SourceCode
                key={activeCode.serviceCode}
                code={activeCode.serviceCode}
              />
            </div>
          </figure>
          {kind === "monolith" ? (
            <figure className="flex min-w-0 flex-col border-t lg:border-t-0">
              <figcaption className="border-b px-4 py-3 font-mono text-xs text-muted-foreground sm:px-6">
                {activeCode.sideFile}
              </figcaption>
              <div className="overflow-x-auto px-4 py-5 sm:px-6">
                <SourceCode
                  key={activeCode.sideCode}
                  code={activeCode.sideCode}
                />
              </div>
              <p className="mt-auto border-t px-4 py-4 text-sm leading-6 text-muted-foreground sm:px-6">
                {activeCode.sideDesc}
              </p>
            </figure>
          ) : (
            <div className="flex min-w-0 flex-col border-t lg:border-t-0">
              <p className="label border-b px-4 py-3 sm:px-6">
                Zero-Refactor Deployment
              </p>
              <div className="space-y-4 px-4 py-5 text-sm leading-6 text-muted-foreground sm:px-6">
                <p>
                  Use the same typed service definitions for direct calls and
                  HTTP routes. The runnable example exposes the users service on
                  port 3000.
                </p>
                <p>
                  Request /api/users/getUser?id=usr_42 to call the action over
                  HTTP.
                </p>
              </div>
              <figure className="mt-auto border-t">
                <figcaption className="label border-b px-4 py-3 sm:px-6">
                  Run the example
                </figcaption>
                <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.7] sm:px-6">
                  <span className="text-gopher-ink select-none">$ </span>
                  {"bun run --cwd examples/showcase serve\n"}
                  <span className="text-gopher-ink select-none">$ </span>
                  {"curl 'http://localhost:3000/api/users/getUser?id=usr_42'"}
                </pre>
              </figure>
            </div>
          )}
        </div>
      </div>

      <section className="brick-stats py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="label">02 / Measured, not guessed</p>
          <Link to="/benchmarks" className="capability-link">
            Explore benchmarks ↗
          </Link>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-y-6 md:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={cn(
                "brick-stat min-w-0 border-l px-4",
                i === 0 && "border-l-0 pl-0",
              )}
            >
              <dt className="label">{stat.label}</dt>
              <dd className="mt-3 text-3xl font-medium tracking-tight tabular-nums sm:text-4xl">
                {(stat.value === undefined
                  ? undefined
                  : stat.unit === "KiB"
                    ? stat.value / 1024
                    : stat.value
                )?.toLocaleString("en-US", {
                  maximumFractionDigits: stat.unit === "req/s" ? 0 : 1,
                }) ?? "—"}
                <span className="mt-1 block font-mono text-xs font-normal text-muted-foreground">
                  {stat.unit}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-xs text-muted-foreground">
          Fixed JSON action throughput · minimal server startup and idle CPU ·
          minified server bundle. Full methodology in benchmarks.
        </p>
      </section>

      <div id="platform" className="home-section-heading home-platform-heading">
        <div>
          <p className="label">03 / BUILT TO FIT TOGETHER</p>
          <h2>
            A foundation for
            <br />
            what comes next.
          </h2>
        </div>
        <p className="section-description">
          A focused set of primitives, built on the TypeScript tools you already
          know.
        </p>
      </div>
      <ul className="home-feature-grid">
        {features.map((feature, i) => (
          <li key={feature.title} className="brick-feature">
            <Link to={feature.link} className="group flex h-full flex-col">
              <div
                className="feature-visual"
                aria-hidden="true"
                data-variant={i}
              >
                <span className="visual-index">BRICK / 0{i + 1}</span>
                {i === 5 ? (
                  <div className="visual-bars">
                    {[32, 54, 45, 70, 61, 88, 78, 100].map((height, j) => (
                      <i key={j} style={{ height: `${height}%` }} />
                    ))}
                  </div>
                ) : (
                  <div className="visual-flow">
                    <span>
                      {["ACTION", "ROUTE", "SERVICE", "HTTP", "SESSION"][i]}
                    </span>
                    <b>↓</b>
                    <span>
                      {["EXECUTE", "HANDLER", "ACTION", "SERVICE", "POLICY"][i]}
                    </span>
                  </div>
                )}
                <span className="visual-caption">
                  {
                    [
                      "TYPE-SAFE EXECUTION",
                      "COMPILED AHEAD OF TIME",
                      "DIRECT IN-PROCESS CALLS",
                      "SAME ACTION. NEW INTERFACE.",
                      "YOUR IDENTITY. YOUR RULES.",
                      "MEASURED ON EVERY PUSH",
                    ][i]
                  }
                </span>
              </div>
              <div className="feature-copy">
                <h3 className="flex items-center justify-between font-semibold tracking-tight">
                  {feature.title}
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  {feature.text}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <HomeCapabilities />
    </main>
  );
}
