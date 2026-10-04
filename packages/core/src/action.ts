import type { TSchema, Static } from "@sinclair/typebox";
import {
  type Action,
  type ActionConfig,
  type ActionConfigWithAuthorize,
  type ActionConfigWithoutAuthorize,
  type ActionContext,
  type ActionErrorDefinition,
  type ErrorBuilder,
  type BaseContext,
  ActionExecutionError,
  ValidationError,
  type ValidationErrorItem,
  type Logger,
} from "./types";
import { validateWithSchema } from "./typebox";
import { getGlobalRegistry } from "./registry";

const defaultLogger: Logger = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => console.debug("[DEBUG]", ...args),
};

const DEFAULT_REQUEST = new Request("http://localhost");
let _defaultCtxSeq = 0;

const standardErrorDefaults: Record<string, { status: number; message: string }> = {
  BAD_REQUEST: { status: 400, message: "Bad Request" },
  UNAUTHORIZED: { status: 401, message: "Unauthorized" },
  FORBIDDEN: { status: 403, message: "Forbidden" },
  NOT_FOUND: { status: 404, message: "Not Found" },
  CONFLICT: { status: 409, message: "Conflict" },
  INTERNAL_SERVER_ERROR: { status: 500, message: "Internal Server Error" },
};

function createDefaultContext(partial?: any): BaseContext & any {
  if (partial?._resolved) return partial;
  const seq = (++_defaultCtxSeq).toString(36);
  const req = partial?.request ?? DEFAULT_REQUEST;
  return {
    request: req,
    traceId: partial?.traceId || `tr_${seq}`,
    requestId: partial?.requestId || `req_${seq}`,
    db: partial?.db,
    user: partial?.user,
    logger: partial?.logger || defaultLogger,
    services: partial?.services || {},
    metadata: partial?.metadata || {},
    ...partial,
    _resolved: true,
  };
}

export function buildErrorHelpers<TErrors extends Record<string, ActionErrorDefinition>>(
  errorsDef?: TErrors
): ErrorBuilder<TErrors> {
  const helpers: Record<string, any> = {};

  // 1. Populate standard HTTP error helpers
  for (const [code, def] of Object.entries(standardErrorDefaults)) {
    helpers[code] = (overrideMessage?: string, details?: unknown) => {
      const message = overrideMessage || def.message;
      const status = def.status;
      throw new ActionExecutionError(code, message, status, details);
    };
  }

  // 2. Populate or override with user-defined action errors
  if (errorsDef) {
    for (const [code, def] of Object.entries(errorsDef)) {
      helpers[code] = (overrideMessage?: string, details?: unknown) => {
        const message = overrideMessage || def.message;
        const status = def.status || 400;
        throw new ActionExecutionError(code, message, status, details);
      };
    }
  }

  return helpers as ErrorBuilder<TErrors>;
}

export function defineAction<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>,
  TContext extends ActionContext = ActionContext
>(
  config: ActionConfigWithAuthorize<TInputSchema, TOutputSchema, TErrors, TContext>
): Action<TInputSchema, TOutputSchema, TErrors, TContext>;

export function defineAction<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<string, ActionErrorDefinition>,
  TContext extends ActionContext = ActionContext
>(
  config: ActionConfigWithoutAuthorize<TInputSchema, TOutputSchema, TErrors, TContext>
): Action<TInputSchema, TOutputSchema, TErrors, TContext>;

export function defineAction(config: any): any {
  const errorHelpers = buildErrorHelpers(config.errors);

  const actionFn = (async (params: {
    input?: any;
    ctx?: any;
  }) => {
    return actionFn.execute(params);
  }) as any;

  Object.defineProperty(actionFn, "name", {
    value: config.name,
    configurable: true,
  });

  actionFn.config = config;
  actionFn.errorHelpers = errorHelpers;

  actionFn.validateInput = (input: unknown) => {
    return validateWithSchema(config.input, input);
  };

  actionFn.validateOutput = (output: unknown) => {
    return validateWithSchema(config.output, output);
  };

  actionFn.run = async (input?: any, ctx?: any) => {
    return actionFn.execute({ input, ctx });
  };

  actionFn.execute = async (params: {
    input?: any;
    ctx?: any;
  }) => {
    let fullCtx: any;
    if (params?.ctx?._resolved) {
      fullCtx = params.ctx;
    } else {
      const boundService = (actionFn as any).service;
      if (boundService && typeof boundService.resolveContext === "function") {
        fullCtx = await boundService.resolveContext(params?.ctx);
      } else {
        fullCtx = createDefaultContext(params?.ctx);
      }
    }

    // Auto-populate ctx.db from the bound service or global registry if not provided in call ctx
    if (!fullCtx.db) {
      if ((actionFn as any).service?.getDb()) {
        fullCtx.db = (actionFn as any).service.getDb();
      } else if (actionFn.serviceName) {
        const s = getGlobalRegistry().get(actionFn.serviceName);
        if (s?.getDb()) {
          fullCtx.db = s.getDb();
        }
      }
    }

    // 1. Validate Input
    if (config.input) {
      const inputValidation = actionFn.validateInput(params?.input);
      if (!inputValidation.success) {
        throw new ValidationError(
          `Validation failed for action '${config.name}' input` as string,
          inputValidation.errors
        );
      }
    }

    // 2. Authorize
    if (config.authorize) {
      const allowed = await config.authorize({
        user: fullCtx.user,
        input: params?.input,
        ctx: fullCtx,
      });
      if (!allowed) {
        throw new ActionExecutionError(
          "UNAUTHORIZED",
          `Access denied for action '${config.name}'`,
          403
        );
      }
    }

    // 3. Execute implementation
    const result = await config.execute({
      input: params?.input,
      ctx: fullCtx,
      error: errorHelpers,
    });

    // 4. Validate Output
    if (config.output) {
      const outputValidation = actionFn.validateOutput(result);
      if (!outputValidation.success) {
        throw new ValidationError(
          `Validation failed for action '${config.name}' output` as string,
          outputValidation.errors,
          500
        );
      }
    }

    return result;
  };

  return actionFn;
}
