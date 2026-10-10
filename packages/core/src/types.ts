import type { ServicePlugin, ResourcePlugin } from "./plugin";
import type { TSchema, Static } from "@sinclair/typebox";
import type { BunSQLiteDatabase } from "./db/sqlite";
import type { DatabaseHandle } from "./db/define";

export interface Logger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

/**
 * Base framework context supplied to all service resolvers and action executions.
 */
export interface BaseContext<TDb = any> {
  request: Request;
  db: TDb;
  logger: Logger;
  traceId: string;
  requestId?: string;
  services?: Record<string, any>;
  metadata?: Record<string, unknown>;
}

/**
 * Default fallback service context for untyped or simple services.
 */
export interface DefaultServiceContext {
  user?: any;
  session?: any;
  [key: string]: any;
}

/**
 * The combined execution context: BaseContext & TServiceContext.
 */
export type ActionContext<
  TDb = any,
  TServiceContext = DefaultServiceContext,
> = BaseContext<TDb> & TServiceContext;

/**
 * Type utility that automatically narrows ctx.user from User | null to User
 * in execute() when authorize() is declared on the action.
 */
export type NarrowAuthorizedContext<TCtx> = TCtx extends { user: infer U }
  ? [U] extends [null | undefined]
    ? TCtx
    : Omit<TCtx, "user"> & { user: NonNullable<U> }
  : TCtx;

export interface ActionErrorDefinition {
  status?: number;
  message: string;
}

export interface ValidationErrorItem {
  path: string;
  message: string;
  value?: unknown;
  type?: number;
}

export class ValidationError extends Error {
  readonly status: number;
  readonly errors: ValidationErrorItem[];

  constructor(
    message: string,
    errors: ValidationErrorItem[] = [],
    status = 400,
  ) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
    this.errors = errors;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      errors: this.errors,
    };
  }
}

export class ActionExecutionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ActionExecutionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

export interface StandardErrorMap {
  BAD_REQUEST: (overrideMessage?: string, details?: unknown) => never;
  UNAUTHORIZED: (overrideMessage?: string, details?: unknown) => never;
  FORBIDDEN: (overrideMessage?: string, details?: unknown) => never;
  NOT_FOUND: (overrideMessage?: string, details?: unknown) => never;
  CONFLICT: (overrideMessage?: string, details?: unknown) => never;
  INTERNAL_SERVER_ERROR: (overrideMessage?: string, details?: unknown) => never;
  [key: string]:
    | ((overrideMessage?: string, details?: unknown) => never)
    | undefined;
}

export type ErrorBuilder<
  TErrors extends Record<string, ActionErrorDefinition>,
> = StandardErrorMap & {
  [K in keyof TErrors]: (overrideMessage?: string, details?: unknown) => never;
};

export interface BaseActionConfig<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
> {
  name: string;
  description?: string;
  /** Effective HTTP path, including the prefix; replaces the default action path. */
  path?: string;
  /** Single HTTP method exposed for this action (default POST). */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input?: TInputSchema;
  output?: TOutputSchema;
  errors?: TErrors;
  emits?: string[];
  tags?: string[];
}

export interface ActionConfigWithAuthorize<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
> extends BaseActionConfig<TInputSchema, TOutputSchema, TErrors> {
  authorize: (params: {
    user?: TContext extends { user: infer U } ? U : any;
    input: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx: TContext;
  }) => boolean | Promise<boolean>;
  execute: (params: {
    input: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx: NarrowAuthorizedContext<TContext>;
    error: ErrorBuilder<TErrors>;
  }) =>
    | Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>
    | (TOutputSchema extends TSchema ? Static<TOutputSchema> : any);
}

export interface ActionConfigWithoutAuthorize<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
> extends BaseActionConfig<TInputSchema, TOutputSchema, TErrors> {
  authorize?: undefined;
  execute: (params: {
    input: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx: TContext;
    error: ErrorBuilder<TErrors>;
  }) =>
    | Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>
    | (TOutputSchema extends TSchema ? Static<TOutputSchema> : any);
}

export type ActionConfig<
  TInputSchema extends TSchema | undefined = any,
  TOutputSchema extends TSchema | undefined = any,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
> =
  | ActionConfigWithAuthorize<TInputSchema, TOutputSchema, TErrors, TContext>
  | ActionConfigWithoutAuthorize<
      TInputSchema,
      TOutputSchema,
      TErrors,
      TContext
    >;

export interface Action<
  TInputSchema extends TSchema | undefined = any,
  TOutputSchema extends TSchema | undefined = any,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
> {
  (params: {
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx?: Partial<TContext>;
  }): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;

  name: string;
  serviceName?: string;
  config: ActionConfig<TInputSchema, TOutputSchema, TErrors, TContext>;
  run(
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any,
    ctx?: Partial<TContext>,
  ): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  execute(params: {
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx?: Partial<TContext>;
  }): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  executeResolved?(params: {
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx: TContext;
  }): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  validateInput(
    input: unknown,
  ):
    | { success: true; data: any }
    | { success: false; errors: ValidationErrorItem[] };
  validateOutput(
    output: unknown,
  ):
    | { success: true; data: any }
    | { success: false; errors: ValidationErrorItem[] };
  errorHelpers?: ErrorBuilder<TErrors>;
}

/** MCP tool metadata, kept with the executable definition. */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
export interface ToolOptions {
  title?: string;
  annotations?: ToolAnnotations;
  /** Also register HTTP routes and OpenAPI. Defaults to false. */
  http?: boolean;
}
export type ToolConfigWithAuthorize<
  I extends TSchema | undefined = undefined,
  O extends TSchema | undefined = undefined,
  E extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  C extends ActionContext = ActionContext,
> = ActionConfigWithAuthorize<I, O, E, C> & ToolOptions;
export type ToolConfigWithoutAuthorize<
  I extends TSchema | undefined = undefined,
  O extends TSchema | undefined = undefined,
  E extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  C extends ActionContext = ActionContext,
> = ActionConfigWithoutAuthorize<I, O, E, C> & ToolOptions;
export interface Tool<
  I extends TSchema | undefined = any,
  O extends TSchema | undefined = any,
  E extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  C extends ActionContext = ActionContext,
> extends Action<I, O, E, C> {
  readonly kind: "tool";
  config:
    | ToolConfigWithAuthorize<I, O, E, C>
    | ToolConfigWithoutAuthorize<I, O, E, C>;
}

/** A resource declares identity and a table; plugins supply behavior. */
export interface ResourceConfig<TTable = any, _TCtx = any> {
  name: string;
  table: TTable;
  id?: import("drizzle-orm").Column;
}

export type InferTableRow<TTable> = TTable extends { $inferSelect: infer S }
  ? S
  : any;
export type InferTableInsert<TTable> = TTable extends { $inferInsert: infer S }
  ? S
  : any;
export type ResourceTypeOptions = Pick<ResourceConfig, "name" | "id">;

type PrimaryColumn<T> = T extends { _: { columns: infer C } }
  ? {
      [K in keyof C]: C[K] extends { _: { isPrimaryKey: true } } ? C[K] : never;
    }[keyof C]
  : import("drizzle-orm").Column;
export type ResourceIdentity<T, O> = O & {
  id: O extends { id: infer I extends import("drizzle-orm").Column }
    ? I
    : PrimaryColumn<T>;
};

/** Generic preparation declarations consumed by the application compiler. */
export interface PreparationContribution {
  readonly name: string;
  describe(): unknown;
  prepare(): void;
}

export interface Resource<
  TTable = any,
  TCtx extends ActionContext = ActionContext,
  TOptions = {},
> {
  use<
    P extends ResourcePlugin<
      Service<TCtx["db"], Omit<TCtx, keyof BaseContext>>,
      this,
      any
    >,
  >(
    plugin: P,
  ): this & import("./plugin").ResourcePluginAPI<P, TTable, TCtx, this>;
  readonly name: string;
  readonly serviceName: string;
  readonly table: TTable;
  readonly id: TOptions extends {
    id: infer I extends import("drizzle-orm").Column;
  }
    ? I
    : import("drizzle-orm").Column;
  readonly idField: string;
  readonly config: ResourceConfig<TTable, TCtx> & TOptions;
}

export interface ServiceAuthOptions {
  requireAuth?: boolean;
  allowedRoles?: string[];
  policy?: (ctx: ActionContext) => boolean | Promise<boolean>;
}

export interface RateLimitOptions {
  maxRequests: number;
  window: number | string;
  scope?: "ip" | "user" | "tenant";
}

export interface CacheOptions {
  driver?: "memory" | "redis";
  defaultTtl?: number;
}

export interface ResilienceOptions {
  timeoutMs?: number;
  retry?: {
    attempts: number;
    backoff: "linear" | "exponential";
    delayMs: number;
  };
  circuitBreaker?: {
    errorThresholdPercentage: number;
    resetTimeoutMs: number;
  };
}

export interface TelemetryOptions {
  traceQueries?: boolean;
  auditLog?: boolean;
  tags?: Record<string, string>;
}

export interface LifecycleOptions {
  onInit?: (ctx: { db?: any; logger?: Logger }) => Promise<void>;
  onDestroy?: () => Promise<void>;
}

export interface ServiceOptions<
  TServiceContext extends Record<string, any> = Record<string, any>,
  TDb = any,
> {
  database?: DatabaseHandle<TDb>;
  context?: (
    baseCtx: BaseContext<TDb>,
  ) => Promise<TServiceContext> | TServiceContext;
  auth?: ServiceAuthOptions;
  rateLimit?: RateLimitOptions;
  cache?: CacheOptions;
  resilience?: ResilienceOptions;
  telemetry?: TelemetryOptions;
  lifecycle?: LifecycleOptions;
}

export interface ActionSchema {
  name: string;
  serviceName?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  hasAuthorize: boolean;
  errors?: Record<string, ActionErrorDefinition>;
  emits?: string[];
  tags?: string[];
}

export interface ServiceSchema {
  name: string;
  options: Omit<ServiceOptions, "database"> & {
    database?: {
      name?: string;
      engine: "sqlite" | "postgres";
      tables: string[];
    };
  };
  hasDatabase: boolean;
  databaseConfig?: {
    name?: string;
    engine: "sqlite" | "postgres";
    tables: string[];
  };
  actions: ActionSchema[];
  resources?: { name: string }[];
}

export interface ArchitectureSchema {
  version: string;
  services: ServiceSchema[];
}

export interface CompiledRoutePlan {
  service: Service<any, any>;
  action: Action<any, any, any, any>;
  actionName: string;
  serviceName: string;
  routePath: string;
  method?: string;
  isGetLike: boolean;
  hasInput: boolean;
  hasContextHook: boolean;
  contextHook?: (baseCtx: any) => Promise<any> | any;
  hasAuthorize: boolean;
  authorize?: (params: any) => boolean | Promise<boolean>;
  execute: (params: any) => Promise<any> | any;
  inputChecker?: {
    Check: (val: any) => boolean;
    Errors: (val: any) => Iterable<any>;
  };
  outputChecker?: {
    Check: (val: any) => boolean;
    Errors: (val: any) => Iterable<any>;
  };
  coercions?: Array<{ key: string; isNumber: boolean; isBoolean: boolean }>;
  logger: Logger;
  errorBuilder: any;
  cachedDb: any;
}

export interface Service<
  TDb = BunSQLiteDatabase<Record<string, unknown>>,
  TServiceContext extends Record<string, any> = Record<string, any>,
> {
  readonly name: string;
  readonly options: ServiceOptions<TServiceContext, TDb>;
  readonly actions: Map<string, Action<any, any, any, any>>;
  readonly tools: Map<string, Tool<any, any, any, any>>;
  readonly tables: Map<string, any>;
  readonly resources: Map<
    string,
    Resource<any, BaseContext<TDb> & TServiceContext>
  >;
  readonly db?: TDb;
  readonly isBuilt?: boolean;

  use<A>(plugin: ServicePlugin<this, A>): A;

  build(): this;

  action<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    action: Action<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>,
  ): this;

  action<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    config: ActionConfigWithAuthorize<
      TIn,
      TOut,
      TErr,
      BaseContext<TDb> & TServiceContext
    >,
  ): Action<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>;

  action<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    config: ActionConfigWithoutAuthorize<
      TIn,
      TOut,
      TErr,
      BaseContext<TDb> & TServiceContext
    >,
  ): Action<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>;

  tool<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    action: Tool<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>,
  ): this;

  tool<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    config: ToolConfigWithAuthorize<
      TIn,
      TOut,
      TErr,
      BaseContext<TDb> & TServiceContext
    >,
  ): Tool<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>;

  tool<
    TIn extends TSchema | undefined = undefined,
    TOut extends TSchema | undefined = undefined,
    TErr extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
  >(
    config: ToolConfigWithoutAuthorize<
      TIn,
      TOut,
      TErr,
      BaseContext<TDb> & TServiceContext
    >,
  ): Tool<TIn, TOut, TErr, BaseContext<TDb> & TServiceContext>;

  resource<
    TTable = any,
    const TOptions extends ResourceTypeOptions = ResourceTypeOptions,
  >(
    config: ResourceConfig<TTable, BaseContext<TDb> & TServiceContext> &
      TOptions &
      Record<Exclude<keyof TOptions, keyof ResourceConfig>, never>,
  ): Resource<
    TTable,
    BaseContext<TDb> & TServiceContext,
    ResourceIdentity<TTable, TOptions>
  >;

  readonly preparations: Map<string, PreparationContribution>;
  contributePreparation(contribution: PreparationContribution): void;
  listPreparations(): PreparationContribution[];
  prepareContributions(): void;
  registerTable(table: any): this;
  getAction(name: string): Action<any, any, any, any> | undefined;
  listActions(): Action<any, any, any, any>[];
  getTool(name: string): Tool<any, any, any, any> | undefined;
  listTools(): Tool<any, any, any, any>[];
  getResource(
    name: string,
  ): Resource<any, BaseContext<TDb> & TServiceContext> | undefined;
  listResources(): Resource<any, BaseContext<TDb> & TServiceContext>[];
  getDb(): TDb | undefined;
  setDb(database: DatabaseHandle<TDb>): void;
  resolveContext(
    callCtx?: Partial<BaseContext<TDb> & TServiceContext>,
  ): Promise<BaseContext<TDb> & TServiceContext>;
  introspect(): ServiceSchema;
}

export interface ProxyOptions {
  isMonolith?: boolean;
  context?: Partial<ActionContext>;
}
