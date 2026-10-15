// Runs inside one example directory (cwd) and prints its architecture as JSON.
// Usage: bun example-architecture.ts <entry>
// The generator runs this in a subprocess so example code never reaches the site.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const entry = process.argv[2];
if (!entry) throw new Error("Usage: example-architecture.ts <entry>");

// Use the example's own @brickkit/core so the global registry is shared.
const require = createRequire(resolve("package.json"));
const core = await import(
  pathToFileURL(require.resolve("@brickkit/core")).href
);
// drizzle-orm is a dependency of core, not necessarily of the example.
const coreRequire = createRequire(require.resolve("@brickkit/core"));
const drizzle = await import(
  pathToFileURL(coreRequire.resolve("drizzle-orm")).href
).catch(() => undefined);

const isService = (value: any) =>
  !!value &&
  typeof value.introspect === "function" &&
  typeof value.name === "string";

const mod = await import(pathToFileURL(resolve(entry)).href);

// Accept a BrickApp (default or `app`), a `buildApp()` factory, or exported services.
async function resolveApp() {
  for (const candidate of [mod.default, mod.app]) {
    if (core.isBrickApp?.(candidate)) return candidate;
  }
  if (typeof mod.buildApp === "function") return await mod.buildApp();
  const services = Object.values(mod).filter(isService);
  if (services.length) return core.brick({ services });
  throw new Error(`${entry}: export a BrickApp, buildApp() or services`);
}

const app = await resolveApp();
const architecture = core
  .getGlobalRegistry()
  .exportArchitecture(app.definition);

const byName = new Map<string, any>(
  app.definition.services.map((service: any) => [service.name, service]),
);

const services = architecture.services.map((service: any) => {
  const tables = byName.get(service.name)?.options?.database?.tables as
    | Record<string, any>
    | undefined;
  return {
    name: service.name,
    engine: service.databaseConfig?.engine,
    resources: (service.resources ?? []).map((r: any) => r.name),
    tables: (service.databaseConfig?.tables ?? []).map((name: string) => {
      const table = tables?.[name];
      const columns =
        table && drizzle ? Object.values(drizzle.getTableColumns(table)) : [];
      return {
        name: (table && drizzle?.getTableName(table)) ?? name,
        columns: columns.map((c: any) => ({
          name: c.name,
          type:
            typeof c.getSQLType === "function" ? c.getSQLType() : c.dataType,
          notNull: !!c.notNull,
          primary: !!c.primary,
        })),
      };
    }),
    actions: service.actions.map((a: any) => ({
      name: a.name,
      method: a.method,
      path: a.path,
      plugin: a.plugin,
      resource: a.resource,
      description: a.description,
      accessPolicy: a.accessPolicy,
      hasAuthorize: a.hasAuthorize,
      emits: a.emits,
      tags: a.tags,
    })),
  };
});

console.log(JSON.stringify({ prefix: app.definition.prefix, services }));
process.exit(0);
