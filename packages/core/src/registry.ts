import type { Service, ArchitectureSchema } from "./types";
import { analyzeDeclaredApplication, type RouteIR } from "./compiler/ir";
import type { EventsDefinition } from "./events/hub";
import type { BrickSocketSchema } from "./socket-types";
import { fileURLToPath } from "node:url";

// The package root (src/ or dist/ is beneath it), so Brick's own frames are skipped.
const brickRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * The first `file:line` outside Brick on the current stack: where a name is
 * being defined. Best-effort: `undefined` when there is no stack.
 */
export function definitionSite(): string | undefined {
  // Plugins nest several Brick frames above the caller's.
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const stack = new Error().stack;
  Error.stackTraceLimit = limit;
  for (const line of stack?.split("\n").slice(1) ?? []) {
    const match =
      /(?:\(|at )(?:file:\/\/)?([^\s()?]+)(?:\?[^\s():]*)?:(\d+):\d+\)?$/.exec(
        line,
      );
    if (!match) continue;
    const [, file, row] = match;
    if (
      file!.startsWith(`${brickRoot}src/`) ||
      file!.startsWith(`${brickRoot}dist/`)
    )
      continue;
    return `${file}:${row}`;
  }
  return undefined;
}

/**
 * Records where `name` is defined. The same file defining it again (a dev
 * reload) replaces the old definition.
 *
 * @throws When a different file already defined `name`.
 */
export function claimName(
  sites: Map<string, string | undefined>,
  label: string,
  name: string,
  site: string | undefined,
): void {
  const file = (at: string | undefined) => at?.replace(/:\d+$/, "");
  if (sites.has(name) && file(sites.get(name)) !== file(site))
    throw new Error(
      `Brick: duplicate ${label}\n  ${sites.get(name) ?? "unknown"}\n  ${site ?? "unknown"}`,
    );
  sites.set(name, site);
}

export interface ArchitectureApplication {
  services: readonly Service[];
  routes: readonly RouteIR[];
  events?: EventsDefinition;
  sockets?: readonly (BrickSocketSchema & { service: string; path: string })[];
}

export class ServiceRegistry {
  private _revision = 0;
  /** Definition revision for invalidating serialized architecture snapshots. */
  get revision(): number {
    return this._revision;
  }
  touch(): void {
    this._revision++;
  }

  private services = new Map<string, Service>();
  private sites = new Map<string, string | undefined>();
  private routes = new Map<Service, readonly RouteIR[]>();

  /** Remember the actual registered routes for subsequent registry exports. */
  setApplicationRoutes(application: ArchitectureApplication): void {
    for (const service of application.services) {
      this.routes.set(
        service,
        application.routes.filter((route) => route.service === service.name),
      );
    }
    this.touch();
  }

  /** @throws When a different file already registered a service with this name. */
  register(service: Service, site = definitionSite()): void {
    claimName(this.sites, `service "${service.name}"`, service.name, site);
    const previous = this.services.get(service.name);
    if (previous) this.routes.delete(previous);
    this.services.set(service.name, service);
    this.touch();
  }

  get(name: string): Service | undefined {
    return this.services.get(name);
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  list(): Service[] {
    return Array.from(this.services.values());
  }

  clear(): void {
    this.services.clear();
    this.sites.clear();
    this.routes.clear();
    this.touch();
  }

  exportArchitecture(
    application?: ArchitectureApplication,
  ): ArchitectureSchema {
    return {
      version: "1.0.0",
      ...(application?.events ? { events: application.events } : {}),
      services: (application?.services ?? this.list()).map((service) => {
        const routes = application
          ? application.routes.filter((route) => route.service === service.name)
          : (this.routes.get(service) ??
            analyzeDeclaredApplication([service]).ir.routes);
        const byAction = new Map(routes.map((route) => [route.action, route]));
        const schema = service.introspect();
        return {
          ...schema,
          ...(application?.sockets
            ? {
                sockets: application.sockets.filter(
                  (socket) => socket.service === service.name,
                ),
              }
            : {}),
          actions: schema.actions.map((action) => {
            const route = byAction.get(action.name);
            return route
              ? { ...action, method: route.method, path: route.path }
              : action;
          }),
        };
      }),
    };
  }
}

// Global registry instance
let globalRegistry = new ServiceRegistry();

/**
 * The registry every `defineService` adds to: it is how `brick()`, the OpenAPI
 * generator, `createServiceProxy`, and the dashboard find services by name.
 *
 * @returns The current global registry.
 */
export function getGlobalRegistry(): ServiceRegistry {
  return globalRegistry;
}

/**
 * Start over with an empty global registry. For tests, which define the same
 * services again in each case; an application never needs it.
 */
export function resetGlobalRegistry(): void {
  globalRegistry = new ServiceRegistry();
}
