import { Effect } from "effect";
import {
  runEffectPromise,
  effectExecutionKey,
  effectAuthorizationKey,
  normalizeEffectError,
  withEffectRuntime,
} from "./effect-runtime";
import type { TSchema } from "@sinclair/typebox";
import {
  type Action,
  type ActionConfigWithAuthorize,
  type ActionConfigWithoutAuthorize,
  type ActionContext,
  type ActionErrorDefinition,
  type ErrorBuilder,
  type BaseContext,
  ActionExecutionError,
  ValidationError,
  type Logger,
} from "./types";
import { normalizeActionError } from "./error-response";
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

// Symbol to tie context resolution to a specific service instance and invocation
const RESOLVED_SYMBOL = Symbol("resolved");

const standardErrorDefaults: Record<
  string,
  { status: number; message: string }
> = {
  BAD_REQUEST: { status: 400, message: "Bad Request" },
  UNAUTHORIZED: { status: 401, message: "Unauthorized" },
  FORBIDDEN: { status: 403, message: "Forbidden" },
  NOT_FOUND: { status: 404, message: "Not Found" },
  CONFLICT: { status: 409, message: "Conflict" },
  INTERNAL_SERVER_ERROR: { status: 500, message: "Internal Server Error" },
};

function createDefaultContext(partial?: any): BaseContext & any {
  // Only accept pre-resolved context with a service-specific marker or when service will handle resolution
  if (partial?.[RESOLVED_SYMBOL]) return partial;
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
    [RESOLVED_SYMBOL]: true,
  };
}

export function buildErrorHelpers<
  TErrors extends Record<string, ActionErrorDefinition>,
>(errorsDef?: TErrors): ErrorBuilder<TErrors> {
  const helpers: Record<string, any> = {};

  // 1. Populate standard HTTP error helpers
  for (const [code, def] of Object.entries(standardErrorDefaults)) {
    helpers[code] = (
      overrideMessage?: string,
      details?: unknown,
      options?: ErrorOptions,
    ) => {
      const message = overrideMessage || def.message;
      const status = def.status;
      throw new ActionExecutionError(code, message, status, details, options);
    };
  }

  // 2. Populate or override with user-defined action errors
  if (errorsDef) {
    for (const [code, def] of Object.entries(errorsDef)) {
      helpers[code] = (
        overrideMessage?: string,
        details?: unknown,
        options?: ErrorOptions,
      ) => {
        const message = overrideMessage || def.message;
        const status = def.status || 400;
        throw new ActionExecutionError(code, message, status, details, options);
      };
    }
  }

  return helpers as ErrorBuilder<TErrors>;
}

export function defineAction<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
>(
  config: ActionConfigWithAuthorize<
    TInputSchema,
    TOutputSchema,
    TErrors,
    TContext
  >,
): Action<TInputSchema, TOutputSchema, TErrors, TContext>;

export function defineAction<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
>(
  config: ActionConfigWithoutAuthorize<
    TInputSchema,
    TOutputSchema,
    TErrors,
    TContext
  >,
): Action<TInputSchema, TOutputSchema, TErrors, TContext>;

export function defineAction(config: any): any {
  return createAction(
    config,
    config[effectExecutionKey] ??
      ((params: any) =>
        // Native implementations throw plain values; redact unexpected
        // failures into typed 500s like the Promise-based runtime does.
        withEffectRuntime(() => config.execute(params)).pipe(
          Effect.catch((error) =>
            error instanceof ActionExecutionError ||
            error instanceof ValidationError
              ? Effect.fail(error)
              : Effect.fail(normalizeActionError(error, params.ctx)),
          ),
          Effect.catchDefect((defect) =>
            Effect.fail(normalizeActionError(defect, params.ctx)),
          ),
        )),
  );
}

export async function runActionEffect<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return runEffectPromise(effect);
}

export function createAction(
  config: any,
  execute: (params: any) => Effect.Effect<unknown, unknown, any>,
): any {
  const errorHelpers = buildErrorHelpers(config.errors);

  const actionFn = (async (params: { input?: any; ctx?: any }) => {
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
    const runtimeSchema =
      (actionFn as { outputValidationSchema?: TSchema })
        .outputValidationSchema ?? config.output;
    return validateWithSchema(runtimeSchema, output);
  };

  actionFn.run = async (input?: any, ctx?: any) => {
    return actionFn.execute({ input, ctx });
  };

  actionFn.execute = (params: { input?: any; ctx?: any }) =>
    runEffectPromise(
      actionFn.executeEffect(params),
      actionFn.service,
      params?.ctx?.request?.signal,
    );

  actionFn.executeEffect = (params: { input?: any; ctx?: any }) =>
    Effect.gen(function* () {
      const boundService = actionFn.service;
      const fullCtx = yield* boundService?.resolveContextEffect
        ? Effect.mapError(
            boundService.resolveContextEffect(params?.ctx),
            normalizeEffectError,
          )
        : Effect.tryPromise({
            try: async () =>
              boundService?.resolveContext
                ? boundService.resolveContext(params?.ctx)
                : createDefaultContext(params?.ctx),
            catch: normalizeEffectError,
          });
      yield* Effect.try({
        try: () => {
          if (!fullCtx.db) {
            const service =
              boundService ??
              (actionFn.serviceName
                ? getGlobalRegistry().get(actionFn.serviceName)
                : undefined);
            if (service?.getDb()) fullCtx.db = service.getDb();
          }
        },
        catch: normalizeEffectError,
      });

      yield* Effect.try({
        try: () => {
          // 1. Validate Input
          if (config.input) {
            const inputValidation = actionFn.validateInput(params?.input);
            if (!inputValidation.success) {
              throw new ValidationError(
                `Validation failed for action '${config.name}' input` as string,
                inputValidation.errors,
              );
            }
          }
        },
        catch: (error) => error,
      });

      // 2. Authorize
      if (config.authorize) {
        const allowed = yield* (
          config[effectAuthorizationKey]
            ? Effect.suspend(() =>
                config[effectAuthorizationKey]({
                  user: fullCtx.user,
                  input: params?.input,
                  ctx: fullCtx,
                }),
              )
            : Effect.tryPromise({
                try: async () =>
                  config.authorize({
                    user: fullCtx.user,
                    input: params?.input,
                    ctx: fullCtx,
                  }),
                catch: (error) =>
                  error instanceof ActionExecutionError ||
                  error instanceof ValidationError
                    ? error
                    : normalizeActionError(error, fullCtx),
              })
        ).pipe(
          Effect.catchDefect((defect) =>
            Effect.fail(normalizeActionError(defect, fullCtx)),
          ),
        );
        if (!allowed) {
          return yield* Effect.fail(
            new ActionExecutionError(
              fullCtx.user == null ? "UNAUTHORIZED" : "FORBIDDEN",
              `Access denied for action '${config.name}'`,
              fullCtx.user == null ? 401 : 403,
            ),
          );
        }
      }

      // 3. Execute implementation
      const result = yield* Effect.suspend(() =>
        execute({
          input: params?.input,
          ctx: fullCtx,
          error: errorHelpers,
        }),
      ).pipe(
        Effect.catchDefect((defect) =>
          Effect.fail(normalizeActionError(defect, fullCtx)),
        ),
      );

      yield* Effect.try({
        try: () => {
          // 4. Validate Output
          const runtimeOutputSchema =
            (actionFn as { outputValidationSchema?: TSchema })
              .outputValidationSchema ?? config.output;
          if (runtimeOutputSchema) {
            const outputValidation = actionFn.validateOutput(result);
            if (!outputValidation.success) {
              throw new ValidationError(
                `Validation failed for action '${config.name}' output` as string,
                outputValidation.errors,
                500,
              );
            }
          }
        },
        catch: (error) => error,
      });
      return result;
    });

  return actionFn;
}
