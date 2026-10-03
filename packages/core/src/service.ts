import type { TSchema } from "@sinclair/typebox";
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
} from "./types";
import { defineAction } from "./action";
import { getGlobalRegistry } from "./registry";
import { createDatabase } from "./db";

const defaultLogger: Logger = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => console.debug("[DEBUG]", ...args),
};

export class ServiceImpl<
  TDb = any,
  TServiceContext extends Record<string, any> = Record<string, any>
> implements Service<TDb, TServiceContext> {
  readonly name: string;
  readonly options: ServiceOptions<any, TServiceContext, TDb>;
  readonly actions = new Map<string, Action<any, any, any, any>>();
  private dbInstance: any = undefined;

  constructor(name: string, options: ServiceOptions<any, TServiceContext, TDb> = {}) {
    this.name = name;
    this.options = options;
    if (options.database) {
      const dbConfig =
        typeof options.database === "object"
          ? { ...options.database, name }
          : { name };
      this.dbInstance = createDatabase(dbConfig);
    }
  }

  get db(): TDb | undefined {
    if (!this.dbInstance && this.options.database) {
      const dbConfig =
        typeof this.options.database === "object"
          ? { ...this.options.database, name: this.name }
          : { name: this.name };
      this.dbInstance = createDatabase(dbConfig);
    }
    return this.dbInstance;
  }

  set db(value: any) {
    this.dbInstance = value;
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

    if (isActionFunction) {
      return this;
    }
    return actionInstance;
  }

  getAction(name: string): Action<any, any, any, any> | undefined {
    return this.actions.get(name);
  }

  listActions(): Action<any, any, any, any>[] {
    return Array.from(this.actions.values());
  }

  getDb<T = TDb>(): T | undefined {
    return this.db as T | undefined;
  }

  setDb(db: any): void {
    this.dbInstance = db;
  }

  /**
   * Resolves the complete service execution context once per incoming request.
   * Merges framework BaseContext with the service's custom context hook.
   */
  async resolveContext(
    callCtx?: Partial<BaseContext<TDb> & TServiceContext>
  ): Promise<BaseContext<TDb> & TServiceContext> {
    if ((callCtx as any)?._resolved) {
      return callCtx as BaseContext<TDb> & TServiceContext;
    }

    const randomId = Math.random().toString(36).substring(2, 10);
    const fullBaseCtx: BaseContext<TDb> = {
      request: callCtx?.request ?? new Request("http://localhost"),
      db: callCtx?.db ?? (this.getDb() as TDb),
      logger: callCtx?.logger ?? defaultLogger,
      traceId: callCtx?.traceId ?? `tr_${randomId}`,
      requestId: callCtx?.requestId ?? `req_${randomId}`,
      services: callCtx?.services ?? {},
      metadata: callCtx?.metadata ?? {},
    };

    let resolvedExtra: any = {};
    if (this.options.context) {
      resolvedExtra = await this.options.context(fullBaseCtx);
    }

    const finalCtx = {
      ...fullBaseCtx,
      ...resolvedExtra,
      ...callCtx,
      _resolved: true,
    };

    return finalCtx;
  }

  introspect(): ServiceSchema {
    return {
      name: this.name,
      options: this.options,
      hasDatabase: Boolean(this.options.database),
      databaseConfig:
        typeof this.options.database === "object"
          ? (this.options.database as any)
          : undefined,
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
    };
  }
}

export function defineService<
  TDb = any,
  TServiceContext extends Record<string, any> = Record<string, any>
>(
  name: string,
  options?: ServiceOptions<any, TServiceContext, TDb>
): Service<TDb, TServiceContext> {
  const service = new ServiceImpl<TDb, TServiceContext>(name, options);
  getGlobalRegistry().register(service as any);
  return service;
}
