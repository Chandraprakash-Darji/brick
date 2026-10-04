import { emitManifest, installCompiledResourceGet, isNativeResourceAction, type Service } from "@elregaldo/core";
import { mkdir, rename, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface CompiledPlans {
  version: 1;
  sourceManifest: string;
  resources: { service: string; resource: string; getSql: string }[];
  nativeReads?: { service: string; resource: string }[];
}

/** Compile once using an installed brickc binary; never spawn Rust per request. */
export async function compilePlans(services: Service<any, any>[], options: { compiler?: string; output?: string; native?: boolean } = {}): Promise<CompiledPlans> {
  const source = sourceManifest(services, options.native ?? false);
  const compiler = options.compiler ?? process.env.BRICKC ?? "brickc";
  const child = Bun.spawn([compiler, "compile", "-"], {
    stdin: new Blob([source]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(`brickc failed (${code}): ${stderr.trim()}`);
  const plans = parsePlans(stdout);
  assertCurrentPlans(plans, services);
  if (options.output) {
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, JSON.stringify(plans, null, 2));
    await rename(temporary, output);
  }
  return plans;
}

function parsePlans(json: string): CompiledPlans {
  const plans = JSON.parse(json);
  if (plans?.version !== 1 || typeof plans.sourceManifest !== "string" || !Array.isArray(plans.resources) ||
      !plans.resources.every((r: any) => typeof r.service === "string" && typeof r.resource === "string" && typeof r.getSql === "string")) {
    throw new Error("Invalid or unsupported brickc plans artifact");
  }
  return plans;
}

export async function loadPlans(path: string): Promise<CompiledPlans> {
  return parsePlans(await readFile(path, "utf8"));
}

export function assertCurrentPlans(plans: CompiledPlans, services: Service<any, any>[]): void {
  if (plans.version !== 1 || plans.sourceManifest !== sourceManifest(services, JSON.parse(plans.sourceManifest).nativeResources !== undefined)) {
    throw new Error("brickc plans are stale or incompatible; run brick build again");
  }
  const expected = services.flatMap(s => s.listResources().map(r => `${s.name}\0${r.name}`));
  const actual = plans.resources.map(r => `${r.service}\0${r.resource}`);
  if (new Set(actual).size !== actual.length || expected.length !== actual.length || expected.some(key => !actual.includes(key))) {
    throw new Error("brickc resource plans do not match the application");
  }
}

/** Bind statements and Drizzle column decoders once at server startup. */
export function installPlans(plans: CompiledPlans, services: Service<any, any>[]): void {
  assertCurrentPlans(plans, services);
  const pending: { plan: any; db: object; get: (id: any) => any }[] = [];
  for (const entry of plans.resources) {
    const service = services.find(s => s.name === entry.service)!;
    const resource = service.listResources().find(r => r.name === entry.resource)!;
    const plan = resource.plan;
    const db = service.getDb() as any;
    // This version targets Bun SQLite. Other database adapters keep Drizzle.
    if (!plan || typeof db?.$client?.query !== "function" || typeof db.$client.run !== "function") continue;
    if (plan.idCol?.name !== Object.values(plan.columns).find((c: any) => c.primary)?.name) {
      throw new Error(`brickc does not yet support a non-primary idField: ${entry.service}.${entry.resource}`);
    }
    const statement = db.$client.query(entry.getSql);
    const columns = Object.entries(plan.columns) as [string, any][];
    pending.push({ plan, db, get: (id: any) => {
      const row = statement.get({ $1: plan.idCol.mapToDriverValue(id) });
      if (row == null) return undefined;
      const result: Record<string, any> = {};
      for (const [key, column] of columns) {
        const value = row[column.name];
        result[key] = value === null ? null : column.mapFromDriverValue(value);
      }
      return result;
    } });
  }
  for (const entry of pending) installCompiledResourceGet(entry.plan, entry.db, entry.get);
}


function sourceManifest(services: Service<any, any>[], native: boolean): string {
  const manifest = emitManifest(services);
  if (!native) return JSON.stringify(manifest);
  const nativeResources = services.flatMap(service => service.listResources().flatMap(resource => {
    const plan = resource.plan!;
    const config = resource.config;
    const columns = Object.values(plan.columns) as any[];
    // Keep callbacks and richer query shapes in Bun until native policy/schema
    // support exists. Never bypass a TypeScript authorization or context hook.
    const supported = isNativeResourceAction(resource.actions.get) && isNativeResourceAction(resource.actions.list) &&
      !service.options.context && !plan.ownerField && !config.hooks &&
      !config.errors && !config.fields && plan.idField === "id" &&
      !resource.actions.get?.config.authorize && !resource.actions.list?.config.authorize &&
      service.getAction(`${resource.name}.get`) === resource.actions.get &&
      service.getAction(`${resource.name}.list`) === resource.actions.list &&
      columns.every(c => ["string", "number", "boolean"].includes(c.dataType) &&
        c.name !== "slug" && !c.enumValues?.length && c.columnType?.startsWith("SQLite"));
    if (!supported) return [];
    const list = typeof config.operations?.list === "object" ? config.operations.list : {};
    const sort = plan.sortable.defaultSortEntries.length ? plan.sortable.defaultSortEntries : plan.sortable.fallbackEntries;
    const orders = sort.map(entry => ({ field: entry.field, dbName: plan.columnMap.get(entry.field).name, descending: entry.dir === "desc" }));
    if (orders[0]?.dbName !== plan.idCol.name) orders.push({ field: plan.idField, dbName: plan.idCol.name, descending: sort[0]?.dir !== "asc" });
    const unchanged = (operation: "create" | "update" | "delete") =>
      config.operations?.[operation] !== false && isNativeResourceAction(resource.actions[operation]) &&
      !resource.actions[operation].config.authorize && service.getAction(`${resource.name}.${operation}`) === resource.actions[operation];
    // This first write adapter excludes custom defaults/generators and timestamps.
    const plainWrites = !config.idGenerator && columns.every(c => !c.hasDefault && !c.defaultFn && !c.onUpdateFn) &&
      !plan.timestampColumns.createdAtKey && !plan.timestampColumns.updatedAtKey && plan.idCol.dataType === "string";
    const writes = plainWrites ? { create: unchanged("create"), update: unchanged("update"), delete: unchanged("delete"),
      idPrefix: config.idPrefix ?? (resource.name.toLowerCase() === "page" ? "pg" : resource.name.slice(0, 3)) } : undefined;
    return [{ service: service.name, resource: resource.name, pluralName: plan.pluralName,
      defaultLimit: list.defaultLimit ?? 50, maxLimit: list.maxLimit ?? 100,
      defaultSort: plan.sortable.defaultSort, orders,
      listFields: Object.keys(plan.projections.defaultProjection ?? plan.columns),
      get: config.operations?.get !== false, list: config.operations?.list !== false, writes,
    }];
  }));
  return JSON.stringify({ ...manifest, nativeResources });
}
