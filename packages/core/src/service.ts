import type { TSchema } from "@sinclair/typebox";
import type {
  Service,
  ServiceOptions,
  Action,
  ActionConfig,
  ActionErrorDefinition,
  ServiceSchema,
} from "./types";
import { defineAction } from "./action";
import { getGlobalRegistry } from "./registry";

export class ServiceImpl implements Service {
  readonly name: string;
  readonly options: ServiceOptions;
  readonly actions = new Map<string, Action<any, any, any>>();
  private dbInstance: any = undefined;

  constructor(name: string, options: ServiceOptions = {}) {
    this.name = name;
    this.options = options;
  }

  action<
    TIn extends TSchema = TSchema,
    TOut extends TSchema = TSchema,
    TErr extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
  >(
    actionOrConfig: Action<TIn, TOut, TErr> | ActionConfig<TIn, TOut, TErr>
  ): this {
    let actionInstance: Action<TIn, TOut, TErr>;

    if (typeof actionOrConfig === "function" && "config" in actionOrConfig) {
      actionInstance = actionOrConfig;
    } else {
      actionInstance = defineAction(actionOrConfig as ActionConfig<TIn, TOut, TErr>);
    }

    actionInstance.serviceName = this.name;
    this.actions.set(actionInstance.name, actionInstance);
    return this;
  }

  getAction(name: string): Action<any, any, any> | undefined {
    return this.actions.get(name);
  }

  listActions(): Action<any, any, any>[] {
    return Array.from(this.actions.values());
  }

  getDb<T = any>(): T | undefined {
    return this.dbInstance;
  }

  setDb(db: any): void {
    this.dbInstance = db;
  }

  introspect(): ServiceSchema {
    return {
      name: this.name,
      options: this.options,
      hasDatabase: Boolean(this.options.database),
      databaseConfig:
        typeof this.options.database === "object"
          ? this.options.database
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

export function defineService(name: string, options: ServiceOptions = {}): Service {
  const service = new ServiceImpl(name, options);
  getGlobalRegistry().register(service);
  return service;
}
