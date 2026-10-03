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

function createDefaultContext(partial?: any): BaseContext & any {
  const randomId = Math.random().toString(36).substring(2, 10);
  const req = partial?.request ?? new Request("http://localhost");
  return {
    request: req,
    traceId: partial?.traceId || `tr_${randomId}`,
    requestId: partial?.requestId || `req_${randomId}`,
    db: partial?.db,
    user: partial?.user,
    logger: partial?.logger || defaultLogger,
    services: partial?.services || {},
    metadata: partial?.metadata || {},
    ...partial,
  };
}

function buildErrorHelpers<TErrors extends Record<string, ActionErrorDefinition>>(
  errorsDef?: TErrors
): ErrorBuilder<TErrors> {
  const helpers: Record<string, any> = {};
  if (!errorsDef) return helpers as ErrorBuilder<TErrors>;

  for (const [code, def] of Object.entries(errorsDef)) {
    helpers[code] = (overrideMessage?: string, details?: unknown) => {
      const message = overrideMessage || def.message;
      const status = def.status || 400;
      throw new ActionExecutionError(code, message, status, details);
    };
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
    const boundService = (actionFn as any).service;
    if (boundService && typeof boundService.resolveContext === "function") {
      fullCtx = await boundService.resolveContext(params.ctx);
    } else {
      fullCtx = createDefaultContext(params.ctx);
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
      const inputValidation = actionFn.validateInput(params.input);
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
        input: params.input,
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
      input: params.input,
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
