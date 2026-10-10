import { getTableColumns, type Column } from "drizzle-orm";
import { installPlugin } from "./plugin";
import type {
  ActionContext,
  Resource,
  ResourceConfig,
  ResourceTypeOptions,
  ResourceIdentity,
  Service,
} from "./types";

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
        resource as Resource<TTable, TCtx, ResourceIdentity<TTable, O>>,
        plugin,
      );
    },
  };
  return resource as Resource<TTable, TCtx, ResourceIdentity<TTable, O>>;
}
