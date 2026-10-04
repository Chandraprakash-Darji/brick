import { createFileRoute, Link } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  BlocksIcon,
  Code2Icon,
  DatabaseIcon,
  FileJsonIcon,
  PlugIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { baseOptions, links } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
});

const headingVariants = cva("font-medium tracking-tight", {
  variants: {
    variant: {
      h2: "text-3xl lg:text-4xl",
      h3: "text-xl lg:text-2xl",
    },
  },
});

const buttonVariants = cva(
  "inline-flex justify-center px-5 py-3 rounded-full font-medium tracking-tight transition-colors",
  {
    defaultVariants: {
      variant: "primary",
    },
    variants: {
      variant: {
        primary:
          "bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90",
        secondary:
          "border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent",
      },
    },
  },
);

const cardVariants = cva(
  "rounded-2xl text-sm p-6 border bg-fd-card shadow-sm",
  {
    variants: {
      defaultVariants: {},
      variant: {
        code: "bg-fd-card border p-0 overflow-hidden",
        secondary: "bg-fd-secondary/50 border-fd-secondary",
      },
    },
  },
);

function Home() {
  return (
    <HomeLayout {...baseOptions()} links={links}>
      <main className="text-fd-foreground pt-4 pb-6 md:pb-12">
        {/* Hero */}
        <div className="relative mx-auto flex w-full max-w-[1400px] flex-col items-center px-4 py-16 text-center md:px-12 md:py-24">
          <p className="border-fd-primary/30 text-fd-primary rounded-full border px-4 py-1.5 text-xs font-medium">
            TypeScript-first resource + action framework
          </p>
          <h1 className="mt-8 mb-6 text-4xl leading-tight font-medium tracking-tight md:text-5xl xl:text-6xl">
            Build your backend
            <br />
            in <span className="text-fd-primary">minutes</span>, not weeks.
          </h1>
          <p className="text-fd-muted-foreground mb-8 max-w-xl text-base md:text-lg">
            Define services, actions, and resources in TypeScript. Typed CRUD
            + OpenAPI on Elysia + Drizzle.
          </p>
          <div className="flex flex-row items-center justify-center gap-4">
            <Link
              to="/docs/$"
              params={{ _splat: "" }}
              className={cn(buttonVariants())}
            >
              Get Started
            </Link>
            <a
              href="https://github.com/Chandraprakash-Darji/brick"
              target="_blank"
              rel="noreferrer noopener"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              GitHub
            </a>
          </div>
        </div>

        {/* Quick start code block */}
        <div className="bg-fd-card relative mx-auto mb-16 w-full max-w-[800px] overflow-hidden rounded-2xl border shadow-lg md:mb-24">
          <div className="text-fd-muted-foreground flex flex-row items-center gap-2 border-b p-3">
            <TerminalIcon className="size-4" />
            <span className="text-xs font-medium">Terminal</span>
            <div className="ms-auto size-2 rounded-full bg-red-400" />
            <div className="size-2 rounded-full bg-yellow-400" />
            <div className="me-2 size-2 rounded-full bg-green-400" />
          </div>
          <div className="p-6 font-mono text-sm">
            <p className="text-fd-muted-foreground">
              $ bun add @elregaldo/core @elregaldo/cli
            </p>
            <p className="text-fd-muted-foreground">
              $ brick dev --port 4000
            </p>
            <p className="text-fd-foreground mt-4">
              brick-ts server listening on :4000
            </p>
            <p className="text-fd-muted-foreground">
              {"  "}Health: http://localhost:4000/_health
            </p>
            <p className="text-fd-muted-foreground">
              {"  "}OpenAPI: http://localhost:4000/openapi.json
            </p>
            <p className="text-fd-muted-foreground">
              {"  "}Scalar Docs: http://localhost:4000/docs
            </p>
          </div>
        </div>

        {/* Features grid */}
        <div className="mx-auto w-full max-w-[1400px] px-4 md:px-12">
          <h2
            className={cn(
              headingVariants({
                className: "mb-12 text-center",
                variant: "h2",
              }),
            )}
          >
            Everything you need
          </h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<BlocksIcon className="size-5" />}
              title="Resource CRUD"
              description="Define a resource once — get List, Get, Create, Update, Delete with filtering, sorting, pagination, and owner scoping automatically."
            />
            <FeatureCard
              icon={<ShieldCheckIcon className="size-5" />}
              title="Actions + TypeBox"
              description="Typed actions with TypeBox input/output schemas, authorize guards, and structured errors validated at runtime."
            />
            <FeatureCard
              icon={<Code2Icon className="size-5" />}
              title="Services + context"
              description="Group actions and resources in services with per-request context resolvers for session, user, and database handles."
            />
            <FeatureCard
              icon={<DatabaseIcon className="size-5" />}
              title="SQLite + Postgres via Drizzle"
              description="One Drizzle table definition runs on SQLite locally and Postgres in production, with syncSchema for dev databases."
            />
            <FeatureCard
              icon={<FileJsonIcon className="size-5" />}
              title="Live OpenAPI"
              description="OpenAPI 3.1 spec generated from the live action mesh. Scalar docs, Swagger UI, and typed clients stay in sync."
            />
            <FeatureCard
              icon={<PlugIcon className="size-5" />}
              title="Raw endpoints + MCP"
              description="Drop to app.endpoint() for HTML, webhooks, or MCP transports with mesh-consistent error mapping and service DB access."
            />
          </div>
        </div>

        {/* Service definition example */}
        <div className="mx-auto mt-24 w-full max-w-[1400px] px-4 md:px-12">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="flex flex-col justify-center">
              <h3
                className={cn(
                  headingVariants({ className: "mb-4", variant: "h3" }),
                )}
              >
                Define, serve, ship.
              </h3>
              <p className="text-fd-muted-foreground mb-6">
                Define the database once, attach a service with context, and
                register a resource — typed CRUD, validation, and OpenAPI come
                from the definitions.
              </p>
              <ul className="text-fd-muted-foreground list-inside list-disc space-y-2 text-sm">
                <li>TypeBox schemas inferred from Drizzle tables</li>
                <li>ownerField scoping applied at the SQL level</li>
                <li>Resource hooks for validation and side effects</li>
                <li>List with pagination, sorting, search, and filters</li>
              </ul>
            </div>
            <div className={cn(cardVariants({ variant: "code" }))}>
              <div className="text-fd-muted-foreground border-b px-4 py-2 text-xs font-medium">
                services/pages/service.ts
              </div>
              <ServerCodeBlock
                lang="ts"
                codeblock={{ className: "border-0" }}
                code={`import { defineDatabase, defineService } from "@elregaldo/core";
import { pagesTable } from "./model";

export const appDb = defineDatabase({
  engine: "sqlite",
  name: "pages",
  tables: { pagesTable },
});

export const pagesService = defineService("pages", {
  database: appDb,
  context: async ({ request }) => ({ user: null, session: null }),
});

export const pagesResource = pagesService.resource({
  name: "page",
  table: pagesTable,
  ownerField: "userId",
  operations: { list: { defaultLimit: 20, maxLimit: 100 } },
});`}
              />
            </div>
          </div>
        </div>

        {/* Action + endpoint example */}
        <div className="mx-auto mt-24 w-full max-w-[1400px] px-4 md:px-12">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div
              className={cn(
                cardVariants({ variant: "code" }),
                "max-lg:row-start-2",
              )}
            >
              <div className="text-fd-muted-foreground border-b px-4 py-2 text-xs font-medium">
                server.ts
              </div>
              <ServerCodeBlock
                lang="ts"
                codeblock={{ className: "border-0" }}
                code={`import { createBrickServer } from "@elregaldo/cli";

const app = createBrickServer({ services: [pagesService] });

pagesService.action({
  name: "publish",
  path: "/api/pages/publish",
  method: "POST",
  execute: async ({ input, ctx }) => ({ published: true }),
});

app.endpoint({
  method: "GET",
  path: "/p/:slug",
  service: pagesService,
  summary: "Public page viewer",
  handler: async ({ params, set, db }) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
    return renderPage(params.slug);
  },
});`}
              />
            </div>
            <div className="flex flex-col justify-center">
              <h3
                className={cn(
                  headingVariants({ className: "mb-4", variant: "h3" }),
                )}
              >
                Zero boilerplate CRUD.
              </h3>
              <p className="text-fd-muted-foreground mb-6">
                Each resource gets full CRUD routes with owner scoping via
                ownerField and per-action authorize guards. Hooks run before
                or after writes for validation and side effects.
              </p>
              <ul className="text-fd-muted-foreground list-inside list-disc space-y-2 text-sm">
                <li>List with pagination, sorting, full-text search</li>
                <li>Get by ID with ownership checks</li>
                <li>
                  Create with owner injection from ctx.user
                </li>
                <li>
                  Update with partial patches and timestamp handling
                </li>
                <li>Delete with ownership checks and hooks</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mx-auto mt-24 mb-12 w-full max-w-[1400px] px-4 text-center md:px-12">
          <div className="bg-fd-card rounded-2xl border p-12 shadow-sm">
            <h2
              className={cn(
                headingVariants({
                  className: "mb-4",
                  variant: "h2",
                }),
              )}
            >
              Ready to build?
            </h2>
            <p className="text-fd-muted-foreground mx-auto mb-8 max-w-md">
              brick-ts brings typed actions + auto CRUD to TypeScript. Start
              with the pages example and make it your own.
            </p>
            <div className="flex flex-row items-center justify-center gap-4">
              <Link
                to="/docs/$"
                params={{ _splat: "getting-started" }}
                className={cn(buttonVariants())}
              >
                Read the docs
              </Link>
              <a
                href="https://github.com/Chandraprakash-Darji/brick"
                target="_blank"
                rel="noreferrer noopener"
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                Star on GitHub
              </a>
            </div>
          </div>
        </div>
      </main>
    </HomeLayout>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-fd-card rounded-2xl border p-6 shadow-sm">
      <div className="text-fd-primary mb-4">{icon}</div>
      <h3 className="mb-2 font-medium">{title}</h3>
      <p className="text-fd-muted-foreground text-sm">{description}</p>
    </div>
  );
}