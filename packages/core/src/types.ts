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
  TServiceContext = DefaultServiceContext
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

  constructor(message: string, errors: ValidationErrorItem[] = [], status = 400) {
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
  [key: string]: ((overrideMessage?: string, details?: unknown) => never) | undefined;
}

export type ErrorBuilder<TErrors extends Record<string, ActionErrorDefinition>> =
  StandardErrorMap & {
    [K in keyof TErrors]: (overrideMessage?: string, details?: unknown) => never;
  };

export interface BaseActionConfig<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
> {
  name: string;
  description?: string;
  path?: string;
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
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>,
  TContext extends ActionContext = ActionContext
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
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>,
  TContext extends ActionContext = ActionContext
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
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>,
  TContext extends ActionContext = ActionContext
> =
  | ActionConfigWithAuthorize<TInputSchema, TOutputSchema, TErrors, TContext>
  | ActionConfigWithoutAuthorize<TInputSchema, TOutputSchema, TErrors, TContext>;

export interface Action<
  TInputSchema extends TSchema | undefined = any,
  TOutputSchema extends TSchema | undefined = any,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>,
  TContext extends ActionContext = ActionContext
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
    ctx?: Partial<TContext>
  ): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  execute(params: {
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx?: Partial<TContext>;
  }): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  executeResolved?(params: {
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx: TContext;
  }): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  validateInput(input: unknown): { success: true; data: any } | { success: false; errors: ValidationErrorItem[] };
  validateOutput(output: unknown): { success: true; data: any } | { success: false; errors: ValidationErrorItem[] };
  errorHelpers?: ErrorBuilder<TErrors>;
}

export interface ResourceOperationsConfig {
  list?:
    | boolean
    | {
        defaultLimit?: number;
        maxLimit?: number;
        searchable?: string[];
        sortable?: string[];
        defaultSort?: string;
      };
  get?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}

export type InferTableRow<TTable> = TTable extends { $inferSelect: infer S } ? S : any;
export type InferTableInsert<TTable> = TTable extends { $inferInsert: infer S } ? S : any;

export interface ResourceHooks<
  TRow = any,
  TInsert = any,
  TCtx = any,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
> {
  beforeCreate?: (params: { data: TInsert; ctx: TCtx; error: ErrorBuilder<TErrors> }) => Promise<void> | void;
  afterCreate?: (params: { data: TInsert; result: TRow; ctx: TCtx }) => Promise<void> | void;
  beforeUpdate?: (params: { id: string | number; data: Partial<TInsert>; existing: TRow; ctx: TCtx; error: ErrorBuilder<TErrors> }) => Promise<void> | void;
  afterUpdate?: (params: { id: string | number; data: Partial<TInsert>; result: TRow; ctx: TCtx }) => Promise<void> | void;
  beforeDelete?: (params: { id: string | number; existing: TRow; ctx: TCtx; error: ErrorBuilder<TErrors> }) => Promise<void> | void;
  afterDelete?: (params: { id: string | number; existing: TRow; ctx: TCtx; error: ErrorBuilder<TErrors> }) => Promise<void> | void;
}

export interface ResourceConfig<
  TTable = any,
  TCtx = any,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
> {
  name: string;
  table: TTable;
  ownerField?: string;
  idField?: string;
  idPrefix?: string;
  idGenerator?: () => string;
  pluralName?: string;
  operations?: ResourceOperationsConfig;
  hooks?: ResourceHooks<InferTableRow<TTable>, InferTableInsert<TTable>, TCtx, TErrors>;
  fields?: Record<string, TSchema>;
  errors?: TErrors;
  searchable?: string[];
  sortable?: string[];
  defaultSort?: string;
  /** Columns excluded from default list projection (Go pageMeta parity: content). */
  excludeFromList?: string[];
}

export interface ResourcePlan<TTable = any> {
  readonly resourceName: string;
  readonly pluralName: string;
  readonly table: TTable;
  readonly idField: string;
  readonly idCol: any;
  readonly ownerField?: string;
  readonly ownerCol?: any;
  readonly ownerColName?: string;
  readonly columnMap: Map<string, any>;
  readonly columns: Record<string, any>;
  readonly defaultColumns: ReadonlyArray<{ key: string; default: any }>;
  readonly timestampColumns: {
    readonly createdAtKey: string | null;
    readonly updatedAtKey: string | null;
  };
  readonly searchable: {
    readonly fields?: string[];
    readonly columns: any[];
  };
  readonly sortable: {
    readonly fields: Set<string>;
    readonly defaultSort: string;
    readonly defaultSortEntries: ReadonlyArray<{ field: string; dir: "asc" | "desc" }>;
    readonly fallbackEntries: ReadonlyArray<{ field: string; dir: "asc" | "desc" }>;
    readonly tiebreakCol: any;
  };
  readonly projections: {
    readonly defaultProjection?: Record<string, any>;
  };
  readonly routeTargets: {
    readonly listPath: string;
    readonly itemPath: string;
  };
}

export interface Resource<
  TTable = any,
  TCtx extends ActionContext = ActionContext
> {
  readonly name: string;
  readonly serviceName: string;
  readonly table: TTable;
  readonly ownerField?: string;
  readonly idField: string;
  readonly pluralName: string;
  readonly config: ResourceConfig<TTable, TCtx>;
  readonly plan?: ResourcePlan<TTable>;
  readonly actions: {
    list: Action<any, any, any, TCtx>;
    get: Action<any, any, any, TCtx>;
    create: Action<any, any, any, TCtx>;
    update: Action<any, any, any, TCtx>;
    delete: Action<any, any, any, TCtx>;
  };
  list: Action<any, any, any, TCtx>;
  get: Action<any, any, any, TCtx>;
  create: Action<any, any, any, TCtx>;
  update: Action<any, any, any, TCtx>;
  delete: Action<any, any, any, TCtx>;
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
  TDb = any
> {
  database?: DatabaseHandle<TDb>;
  context?: (baseCtx: BaseContext<TDb>) => Promise<TServiceContext> | TServiceContext;
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
    database?: { name?: string; engine: "sqlite" | "postgres"; tables: string[] };
  };
  hasDatabase: boolean;
  databaseConfig?: { name?: string; engine: "sqlite" | "postgres"; tables: string[] };
  actions: ActionSchema[];
  resources?: {
    name: string;
    ownerField?: string;
    operations: string[];
  }[];
}

export interface ArchitectureSchema {
  version: string;
  services: ServiceSchema[];
}

// Brick Manifest V1 Types for Rust compiler & tooling
export type ManifestFieldTypeV1 =
  | "string"
  | "integer"
  | "boolean"
  | "uuid"
  | "timestamp";

export interface ManifestFieldV1 {
  name: string;
  dbName: string;
  type: ManifestFieldTypeV1;
  nullable: boolean;
  primaryKey: boolean;
}

export interface ManifestTableV1 {
  id: string;
  name: string;
  fields: ManifestFieldV1[];
}

export interface ManifestResourceV1 {
  id: string;
  name: string;
  table: string;
  ownerField?: string;
  searchable: string[];
  sortable: string[];
  operations: string[];
}

export interface ManifestActionV1 {
  id: string;
  name: string;
  execution: "typescript";
}

export interface ManifestServiceV1 {
  id: string;
  name: string;
  tables: ManifestTableV1[];
  resources: ManifestResourceV1[];
  actions: ManifestActionV1[];
}

export interface BrickManifestV1 {
  version: 1;
  services: ManifestServiceV1[];
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
  inputChecker?: { Check: (val: any) => boolean; Errors: (val: any) => Iterable<any> };
  outputChecker?: { Check: (val: any) => boolean; Errors: (val: any) => Iterable<any> };
  coercions?: Array<{ key: string; isNumber: boolean; isBoolean: boolean }>;
  logger: Logger;
  errorBuilder: any;
  cachedDb: any;
}

export interface Service<
  TDb = BunSQLiteDatabase<Record<string, unknown>>,
  TServiceContext extends Record<string, any> = Record<string, any>
> {
  readonly name: string;
  readonly options: ServiceOptions<TServiceContext, TDb>;
  readonly actions: Map<string, Action<any, any, any, any>>;
  readonly tables: Map<string, any>;
  readonly resources: Map<string, Resource<any, BaseContext<TDb> & TServiceContext>>;
  readonly db?: TDb;
  readonly isBuilt?: boolean;

  build(): this;

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

  resource<TTable = any>(
    config: ResourceConfig<TTable, BaseContext<TDb> & TServiceContext>
  ): Resource<TTable, BaseContext<TDb> & TServiceContext>;

  registerTable(table: any): this;
  getAction(name: string): Action<any, any, any, any> | undefined;
  listActions(): Action<any, any, any, any>[];
  getResource(name: string): Resource<any, BaseContext<TDb> & TServiceContext> | undefined;
  listResources(): Resource<any, BaseContext<TDb> & TServiceContext>[];
  getDb(): TDb | undefined;
  setDb(database: DatabaseHandle<TDb>): void;
  resolveContext(
    callCtx?: Partial<BaseContext<TDb> & TServiceContext>
  ): Promise<BaseContext<TDb> & TServiceContext>;
  introspect(): ServiceSchema;
  emitManifest(): BrickManifestV1;
  emitManifestJson(space?: number): string;
}

export interface ProxyOptions {
  isMonolith?: boolean;
  context?: Partial<ActionContext>;
}
