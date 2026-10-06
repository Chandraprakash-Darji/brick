import type { TSchema } from "@sinclair/typebox";
import type { BunSQLiteDatabase } from "./db/sqlite";
import type {
  Service,
  ServiceOptions,
  Action,
  ActionConfigWithAuthorize,
  ActionConfigWithoutAuthorize,
  ActionErrorDefinition,
  ServiceSchema,
  BaseContext,
  Logger,
  Resource,
  ResourceConfig,
} from "./types";
import { defineAction } from "./action";
import { getGlobalRegistry } from "./registry";
import { getTableName, isDatabaseHandle, type DatabaseHandle } from "./db";
import { defineResource, buildResourcePlan } from "./resource";

const defaultLogger: Logger = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => console.debug("[DEBUG]", ...args),
};

const DEFAULT_REQUEST = new Request("http://localhost");
const EMPTY_SERVICES = Object.freeze({});
const EMPTY_METADATA = Object.freeze({});
let _ctxSeq = 0;

export class ServiceImpl<
  TDb = BunSQLiteDatabase<Record<string, unknown>>,
  TServiceContext extends Record<string, any> = Record<string, any>
> implements Service<TDb, TServiceContext> {
  readonly name: string;
  readonly options: ServiceOptions<TServiceContext, TDb>;
  readonly actions = new Map<string, Action<any, any, any, any>>();
  readonly tables = new Map<string, any>();
  readonly resources = new Map<string, Resource<any, BaseContext<TDb> & TServiceContext>>();
  private database?: DatabaseHandle<TDb>;
  private _isBuilt = false;

  constructor(name: string, options: ServiceOptions<TServiceContext, TDb> = {}) {
    this.name = name;
    this.options = options;
    if (options.database !== undefined && !isDatabaseHandle(options.database)) {
      throw new Error("Service database must be created with defineDatabase()");
    }
    this.database = options.database;
  }

  get db(): TDb | undefined {
    return this.getDb();
  }

  get isBuilt(): boolean {
    return this._isBuilt;
  }

  /**
   * Precomputes and freezes execution plans for all registered resources and route targets once.
   * Per-request paths perform O(1) lookups against these immutable plans.
   */
  build(): this {
    if (this._isBuilt) return this;
    for (const resource of this.resources.values()) {
      if (!(resource as any).plan) {
        (resource as any).plan = buildResourcePlan(this, resource.config);
      }
      Object.freeze((resource as any).plan);
    }
    this._isBuilt = true;
    return this;
  }

  registerTable(table: any): this {
    try {
      const tableName = getTableName(table);
      this.tables.set(tableName, table);
    } catch {
      const fallbackName = (table as any)._?.name ?? `table_${this.tables.size + 1}`;
      this.tables.set(fallbackName, table);
    }

    return this;
  }

  resource<TTable = any>(
    config: ResourceConfig<TTable, BaseContext<TDb> & TServiceContext>
  ): Resource<TTable, BaseContext<TDb> & TServiceContext> {
    const resourceInstance = defineResource(this, config);
    this.resources.set(resourceInstance.name, resourceInstance);
    getGlobalRegistry().touch();

    return resourceInstance;
  }

  getResource(name: string): Resource<any, BaseContext<TDb> & TServiceContext> | undefined {
    return this.resources.get(name);
  }

  listResources(): Resource<any, BaseContext<TDb> & TServiceContext>[] {
    return Array.from(this.resources.values());
  }

  action<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
  >(
    action: Action<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>
  ): this;
  action<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
  >(
    config: ActionConfigWithAuthorize<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>
  ): Action<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>;
  action<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
  >(
    config: ActionConfigWithoutAuthorize<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>
  ): Action<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>;
  action(actionOrConfig: any): any {
    let actionInstance: Action<any, any, any, any>;
    const isActionFunction =
      typeof actionOrConfig === "function" && "config" in actionOrConfig;

    if (isActionFunction) {
      actionInstance = actionOrConfig;
    } else {
      actionInstance = defineAction(actionOrConfig);
    }

    actionInstance.serviceName = this.name;
    (actionInstance as any).service = this;
    this.actions.set(actionInstance.name, actionInstance);
    getGlobalRegistry().touch();

    if (isActionFunction) {
      return this;
    }
    return actionInstance;
  }

  getAction(name: string): Action<any, any, any, any> | undefined {
    return this.actions.get(name);
  }

  listActions(): Action<any, any, any, any>[] {
    return Array.from(new Set(this.actions.values()));
  }

  getDb(): TDb | undefined {
    return this.database?.getDb();
  }

  setDb(database: DatabaseHandle<TDb>): void {
    if (!isDatabaseHandle(database)) throw new Error("Use defineDatabase() to set a service database");
    this.database = database;
    getGlobalRegistry().touch();
  }

  /**
   * Resolves the complete service execution context once per incoming request.
   * Merges framework BaseContext with the service's custom context hook.
   */
  resolveContext(
    callCtx?: Partial<BaseContext<TDb> & TServiceContext>
  ): Promise<BaseContext<TDb> & TServiceContext> {
    if ((callCtx as any)?._resolved) {
      return Promise.resolve(callCtx as BaseContext<TDb> & TServiceContext);
    }
    return this._resolveContextSlow(callCtx);
  }

  private async _resolveContextSlow(
    callCtx?: Partial<BaseContext<TDb> & TServiceContext>
  ): Promise<BaseContext<TDb> & TServiceContext> {
    const seq = ++_ctxSeq;
    const req = callCtx?.request ?? DEFAULT_REQUEST;
    const db = callCtx?.db ?? (this.getDb() as TDb);
    const logger = callCtx?.logger ?? defaultLogger;
    const traceId = callCtx?.traceId ?? `tr_${seq.toString(36)}`;
    const requestId = callCtx?.requestId ?? `req_${seq.toString(36)}`;
    const services = callCtx?.services ?? EMPTY_SERVICES;
    const metadata = callCtx?.metadata ?? EMPTY_METADATA;

    if (!this.options.context) {
      const finalCtx: any = {
        request: req,
        db,
        logger,
        traceId,
        requestId,
        services,
        metadata,
        _resolved: true,
      };
      if (callCtx) {
        Object.assign(finalCtx, callCtx, { _resolved: true });
      }
      return finalCtx;
    }

    const fullBaseCtx: any = {
      request: req,
      db,
      logger,
      traceId,
      requestId,
      services,
      metadata,
    };

    const resolvedExtra = await this.options.context(fullBaseCtx);
    const finalCtx: any = {
      ...fullBaseCtx,
      ...resolvedExtra,
      ...callCtx,
      _resolved: true,
    };

    return finalCtx;
  }

  introspect(): ServiceSchema {
    const databaseConfig = this.database
      ? { name: this.database.name, engine: this.database.engine, tables: Object.keys(this.database.tables) }
      : undefined;
    const { database: _database, ...options } = this.options;
    return {
      name: this.name,
      options: { ...options, database: databaseConfig },
      hasDatabase: Boolean(this.database),
      databaseConfig,
      actions: this.listActions().map((act) => ({
        name: act.name,
        serviceName: this.name,
        description: act.config.description,
        inputSchema: act.config.input,
        outputSchema: act.config.output,
        hasAuthorize: Boolean(act.config.authorize),
        errors: act.config.errors,
        emits: act.config.emits,
        tags: act.config.tags,
      })),
      resources: this.listResources().map((res) => ({
        name: res.name,
        ownerField: res.ownerField,
        operations: Object.keys(res.actions),
      })),
    };
  }
}

export function defineService<
  TDb = BunSQLiteDatabase<Record<string, unknown>>,
  TServiceContext extends Record<string, any> = Record<string, any>
>(
  name: string,
  options?: ServiceOptions<TServiceContext, TDb>
): Service<TDb, TServiceContext> {
  const service = new ServiceImpl<TDb, TServiceContext>(name, options);
  getGlobalRegistry().register(service as any);
  return service;
}
