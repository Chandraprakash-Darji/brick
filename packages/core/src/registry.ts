import type { Service,  ArchitectureSchema } from "./types";

export class ServiceRegistry {
  private _revision = 0;
  /** Definition revision for invalidating serialized architecture snapshots. */
  get revision(): number { return this._revision; }
  touch(): void { this._revision++; }

  private services = new Map<string, Service>();

  register(service: Service): void {
    if (this.services.has(service.name)) {
      console.warn(`[Brick-TS] Service '${service.name}' is already registered. Overwriting.`);
    }
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
    this.touch();
  }

  exportArchitecture(): ArchitectureSchema {
    return {
      version: "1.0.0",
      services: this.list().map((s) => s.introspect()),
    };
  }
}

// Global registry instance
let globalRegistry = new ServiceRegistry();

export function getGlobalRegistry(): ServiceRegistry {
  return globalRegistry;
}

export function resetGlobalRegistry(): void {
  globalRegistry = new ServiceRegistry();
}
