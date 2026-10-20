import type { Service, ArchitectureSchema } from "./types";
import { analyzeDeclaredApplication, type RouteIR } from "./compiler/ir";
import type { EventsDefinition } from "./events/hub";

export interface ArchitectureApplication {
  services: readonly Service[];
  routes: readonly RouteIR[];
  events?: EventsDefinition;
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

  register(service: Service): void {
    if (this.services.has(service.name)) {
      console.warn(
        `[Brick-TS] Service '${service.name}' is already registered. Overwriting.`,
      );
    }
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
