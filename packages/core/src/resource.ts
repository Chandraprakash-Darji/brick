import { and, eq, getTableColumns, type Column } from "drizzle-orm";
import type { TObject, TSchema } from "@sinclair/typebox";
import { installPlugin } from "./plugin";
import { defineAction } from "./action";
import { kebabCase, type ResourceActionInfo } from "./routes";
import { Type } from "./typebox";
import type {
  ActionContext,
  Resource,
  ResourceActionAccess,
  ResourceActionConfig,
  ResourceConfig,
  ResourceTypeOptions,
  ResourceIdentity,
  Service,
} from "./types";

/** Resource actions can't take a CRUD route segment. */
const CRUD_SEGMENTS = new Set([
  "query",
  "count",
  "exists",
  "find-one",
  "bulk-create",
  "bulk-update",
  "bulk-delete",
]);

/**
 * Loads one row of a resource by id for a record action, applying the access
 * rule that owns the resource's rows. Resolves `undefined` when the row is
 * missing or hidden from the caller; throws to refuse the caller outright.
 */
export type RecordLoader = (args: {
  id: unknown;
  ctx: any;
  /** A transaction to read in; the context's database otherwise. */
  db?: any;
}) => Promise<Record<string, unknown> | undefined>;

// Process-global so a second core copy (Vite SSR) finds the same loader.
const recordLoaderKey = Symbol.for("brickkit.resource.recordLoader");

/**
 * Make `loader` the way record actions load this resource's rows. `crud` calls
 * it, so a record action reads only rows its `access` lets the caller see.
 *
 * @throws When the resource already has a loader.
 */
export function setRecordLoader(
  resource: Resource<any, any, any>,
  loader: RecordLoader,
): void {
  if (Object.hasOwn(resource, recordLoaderKey))
    throw new Error(`Resource '${resource.name}' already has a record loader`);
  // Plugin rollback restores own properties, so a failed install drops it too.
  Object.defineProperty(resource, recordLoaderKey, {
    value: loader,
    configurable: true,
  });
}

function recordLoaderOf(resource: object): RecordLoader | undefined {
  return (resource as Record<symbol, RecordLoader | undefined>)[
    recordLoaderKey
  ];
}

/**
 * Load the row a record action (or command) works on: through the loader a
 * plugin set (`crud`'s access and scope), or else through `access`.
 *
 * @returns The row, or `undefined` when it is missing or hidden.
 * @throws When the resource has neither a loader nor `access`.
 */
export async function loadRecord(
  resource: Resource<any, any, any>,
  args: {
    id: unknown;
    ctx: any;
    db?: any;
    access?: ResourceActionAccess;
  },
): Promise<Record<string, unknown> | undefined> {
  const loader = recordLoaderOf(resource);
  if (loader) return loader(args);
  if (!args.access)
    throw new Error(
      `Resource '${resource.name}' has no access rule for loading records: install crud or set \`access\` on the record action`,
    );
  const db = args.db ?? args.ctx?.db;
  if (!db) throw new Error("Record actions require a configured database");
  const scope =
    args.access === "public"
      ? undefined
      : await args.access.scope({ ctx: args.ctx });
  const [row] = await db
    .select()
    .from(resource.table)
    .where(and(scope, eq(resource.id, args.id)))
    .limit(1);
  return row;
}

/**
 * Startup check: a record action needs exactly one access rule, `crud`'s or
 * its own.
 */
export function checkRecordAccess(
  resource: Resource<any, any, any>,
  info: ResourceActionInfo,
): void {
  const name = `${resource.name}.${info.name}`;
  const crud = recordLoaderOf(resource) !== undefined;
  if (crud && info.access !== undefined)
    throw new Error(
      `Record action '${name}' sets \`access\`, but resource '${resource.name}' loads rows through its crud access`,
    );
  if (!crud && info.access === undefined)
    throw new Error(
      `Record action '${name}' needs \`access\` ("public" or { scope }) because resource '${resource.name}' has no crud`,
    );
}

function idSchema(column: Column): TSchema {
  return column.dataType === "number" ? Type.Number() : Type.String();
}

function defineResourceAction(
  service: Service<any, any>,
  resource: Resource<any, any, any>,
  config: ResourceActionConfig<any, any, any, any, any, boolean>,
) {
  const { record = false, access, execute, ...rest } = config;
  if (!config.name || /[./]/.test(config.name))
    throw new Error(`Invalid resource action name '${config.name}'`);
  const name = `${resource.name}.${config.name}`;
  const segment = kebabCase(config.name);
  if (CRUD_SEGMENTS.has(segment))
    throw new Error(
      `Brick: duplicate name "${name}" in service "${service.name}": "${segment}" is a CRUD route`,
    );
  if ((service.getAction(name) as { plugin?: string } | undefined)?.plugin)
    throw new Error(
      `Brick: duplicate name "${name}" in service "${service.name}"`,
    );
  if (!record && access !== undefined)
    throw new Error(`Only record actions take \`access\` ('${name}')`);
  if (record && config.path !== undefined && !/\/:id(\/|$)/.test(config.path))
    throw new Error(`Record action '${name}' needs ':id' in its path`);
  let input = config.input as TSchema | undefined;
  if (record) {
    const own = input as TObject | undefined;
    if (own && own.type !== "object")
      throw new Error(`Record action '${name}' input must be an object`);
    input = Type.Object(
      { ...own?.properties, id: idSchema(resource.id) },
      own?.additionalProperties === undefined
        ? {}
        : { additionalProperties: own.additionalProperties },
    );
  }
  const action = defineAction({
    ...rest,
    name,
    input,
    execute: async ({ input, ctx, error }: any) => {
      const row = record
        ? await loadRecord(resource, { id: input.id, ctx, access })
        : undefined;
      if (record && row === undefined)
        error.NOT_FOUND(`${resource.name} '${String(input.id)}' not found`);
      return execute({ input, ctx, error, row } as any);
    },
  } as any);
  const info: ResourceActionInfo = {
    resource: resource.name,
    name: config.name,
    record,
    ...(access === undefined ? {} : { access }),
  };
  Object.assign(action, { resource: resource.name, resourceAction: info });
  service.action(action);
  return action;
}

/** Declares a plugin host without registering actions or changing the schema. */
export function defineResource<
  TTable = any,
  TCtx extends ActionContext = ActionContext,
  const O extends ResourceTypeOptions = ResourceTypeOptions,
>(
  service: Service<any, any>,
  config: ResourceConfig<TTable, TCtx> & O,
): Resource<TTable, TCtx, ResourceIdentity<TTable, O>> {
  const columns = getTableColumns(
    config.table as Parameters<typeof getTableColumns>[0],
  );
  const primary = Object.entries(columns).filter(
    ([, column]) => column.primary,
  );
  const id: Column | undefined =
    config.id ?? (primary.length === 1 ? primary[0]?.[1] : undefined);
  const entry = Object.entries(columns).find(([, column]) => column === id);
  if (!entry || !id)
    throw new Error(
      `Resource '${config.name}' requires an id column belonging to its table`,
    );
  if (
    !config.name ||
    config.name.includes("/") ||
    ["__proto__", "constructor", "prototype"].includes(config.name)
  )
    throw new Error(`Invalid resource name '${config.name}'`);
  service.registerTable(config.table);
  const resource = {
    name: config.name,
    serviceName: service.name,
    table: config.table,
    id,
    idField: entry[0],
    config: Object.freeze({ ...config, id }),
    use(plugin: import("./plugin").ResourcePlugin<any, any, any>) {
      return installPlugin(
        service,
        resource as unknown as Resource<
          TTable,
          TCtx,
          ResourceIdentity<TTable, O>
        >,
        plugin,
      );
    },
    action(
      actionConfig: ResourceActionConfig<any, any, any, any, any, boolean>,
    ) {
      return defineResourceAction(
        service,
        resource as unknown as Resource<any, any, any>,
        actionConfig,
      );
    },
  };
  return resource as unknown as Resource<
    TTable,
    TCtx,
    ResourceIdentity<TTable, O>
  >;
}
