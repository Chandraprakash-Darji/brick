import type { TSchema, Static } from "@sinclair/typebox";

export interface Logger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

export interface ActionContext<TDb = any, TUser = any> {
  traceId: string;
  requestId: string;
  db?: TDb;
  user?: TUser;
  logger: Logger;
  services?: Record<string, any>;
  metadata?: Record<string, unknown>;
}

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

export type ErrorBuilder<TErrors extends Record<string, ActionErrorDefinition>> = {
  [K in keyof TErrors]: (overrideMessage?: string, details?: unknown) => never;
};

export interface ActionConfig<
  TInputSchema extends TSchema = TSchema,
  TOutputSchema extends TSchema = TSchema,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>,
  TContext extends ActionContext = ActionContext
> {
  name: string;
  description?: string;
  input?: TInputSchema;
  output?: TOutputSchema;
  authorize?: (params: {
    user?: any;
    input: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx: TContext;
  }) => boolean | Promise<boolean>;
  errors?: TErrors;
  execute: (params: {
    input: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx: TContext;
    error: ErrorBuilder<TErrors>;
  }) => Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any> | (TOutputSchema extends TSchema ? Static<TOutputSchema> : any);
  emits?: string[];
  tags?: string[];
}

export interface Action<
  TInputSchema extends TSchema = TSchema,
  TOutputSchema extends TSchema = TSchema,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
> {
  (params: {
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx?: Partial<ActionContext>;
  }): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;

  name: string;
  serviceName?: string;
  config: ActionConfig<TInputSchema, TOutputSchema, TErrors>;
  run(
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any,
    ctx?: Partial<ActionContext>
  ): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  execute(params: {
    input?: TInputSchema extends TSchema ? Static<TInputSchema> : any;
    ctx?: Partial<ActionContext>;
  }): Promise<TOutputSchema extends TSchema ? Static<TOutputSchema> : any>;
  validateInput(input: unknown): { success: true; data: any } | { success: false; errors: ValidationErrorItem[] };
  validateOutput(output: unknown): { success: true; data: any } | { success: false; errors: ValidationErrorItem[] };
}

export interface DatabaseOptions {
  engine?: "postgres" | "sqlite" | "clickhouse";
  schemaName?: string;
  migrationsDir?: string;
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutSeconds?: number;
  };
  multiTenant?: boolean;
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

export interface ServiceOptions {
  database?: boolean | DatabaseOptions;
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
  options: ServiceOptions;
  hasDatabase: boolean;
  databaseConfig?: DatabaseOptions;
  actions: ActionSchema[];
}

export interface ArchitectureSchema {
  version: string;
  services: ServiceSchema[];
}

export interface Service {
  readonly name: string;
  readonly options: ServiceOptions;
  readonly actions: Map<string, Action<any, any, any>>;
  action<
    TIn extends TSchema = TSchema,
    TOut extends TSchema = TSchema,
    TErr extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>
  >(
    actionOrConfig: Action<TIn, TOut, TErr> | ActionConfig<TIn, TOut, TErr>
  ): this;
  getAction(name: string): Action<any, any, any> | undefined;
  listActions(): Action<any, any, any>[];
  getDb<T = any>(): T | undefined;
  setDb(db: any): void;
  introspect(): ServiceSchema;
}

export interface ProxyOptions {
  isMonolith?: boolean;
  context?: Partial<ActionContext>;
}
