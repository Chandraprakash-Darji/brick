import { Effect } from "effect";
import type { TSchema } from "@sinclair/typebox";
import type {
  Action,
  ActionConfigWithAuthorize,
  ActionConfigWithoutAuthorize,
  ActionContext,
  ActionErrorDefinition,
  Tool,
  ToolOptions,
  ActionExecutionError,
  ValidationError,
} from "./types";
import { createAction } from "./action";
import {
  runEffectPromise,
  effectExecutionKey,
  effectAuthorizationKey,
} from "./effect-runtime";

type NativeConfig<C extends { execute: (...args: any[]) => any }, E, R> = Omit<
  C,
  "execute" | "authorize"
> & {
  execute: (
    params: Parameters<C["execute"]>[0],
  ) => Effect.Effect<Awaited<ReturnType<C["execute"]>>, E, R>;
};
export type EffectActionConfigWithAuthorize<
  I extends TSchema | undefined,
  O extends TSchema | undefined,
  Errors extends Record<string, ActionErrorDefinition>,
  C extends ActionContext,
  E = never,
  R = never,
> = NativeConfig<ActionConfigWithAuthorize<I, O, Errors, C>, E, R> & {
  authorize: (
    params: Parameters<
      ActionConfigWithAuthorize<I, O, Errors, C>["authorize"]
    >[0],
  ) => Effect.Effect<boolean, E, R> | boolean | Promise<boolean>;
};
export type EffectActionConfigWithoutAuthorize<
  I extends TSchema | undefined,
  O extends TSchema | undefined,
  Errors extends Record<string, ActionErrorDefinition>,
  C extends ActionContext,
  E = never,
  R = never,
> = NativeConfig<ActionConfigWithoutAuthorize<I, O, Errors, C>, E, R> & {
  authorize?: undefined;
};
export type EffectAction<
  I extends TSchema | undefined,
  O extends TSchema | undefined,
  Errors extends Record<string, ActionErrorDefinition>,
  C extends ActionContext,
  E = never,
  R = never,
> = Action<I, O, Errors, C> & {
  executeEffect: (
    params: Parameters<Action<I, O, Errors, C>["execute"]>[0],
  ) => Effect.Effect<
    Awaited<ReturnType<Action<I, O, Errors, C>["execute"]>>,
    E | ActionExecutionError | ValidationError | Error,
    R
  >;
};
export type EffectTool<
  I extends TSchema | undefined,
  O extends TSchema | undefined,
  Errors extends Record<string, ActionErrorDefinition>,
  C extends ActionContext,
  E = never,
  R = never,
> = EffectAction<I, O, Errors, C, E, R> & Tool<I, O, Errors, C>;

/** Normalize native callbacks once; compiled and interpreted transports share them. */
export function adaptEffectActionConfig(config: any, owner?: object): any {
  const execute = (params: any) =>
    Effect.suspend(() => {
      const result = config.execute(params);
      return Effect.isEffect(result)
        ? result
        : Effect.tryPromise({
            try: async () => result,
            catch: (error) => error,
          });
    });
  const authorize = config.authorize
    ? (params: any) =>
        Effect.suspend(() => {
          const result = config.authorize(params);
          return Effect.isEffect(result)
            ? result
            : Effect.tryPromise({
                try: async () => result,
                catch: (error) => error,
              });
        })
    : undefined;
  return {
    ...config,
    [effectExecutionKey]: execute,
    [effectAuthorizationKey]: authorize,
    execute: (params: any) =>
      runEffectPromise(execute(params), owner, params.ctx?.request?.signal),
    ...(authorize
      ? {
          authorize: (params: any) =>
            runEffectPromise(
              authorize(params),
              owner,
              params.ctx?.request?.signal,
            ),
        }
      : {}),
  };
}

/**
 * `defineAction` for Effect: `execute` (and `authorize`) return an `Effect`
 * instead of a promise, run on the owning service's Effect runtime, with the
 * request's abort signal. Failures in the Effect's error channel become the
 * same typed responses as a thrown error would. Imported as `defineAction` from
 * `@brickkit/core/effect`.
 *
 * @param config - The action configuration, with Effect-returning `execute`.
 * @returns The action, to register with `service.action(action)`.
 * @example
 * import { Effect } from "effect";
 * import { defineAction, t } from "@brickkit/core/effect";
 *
 * export const ping = defineAction({
 *   name: "ping",
 *   output: t.String(),
 *   execute: () => Effect.succeed("pong"),
 * });
 */
export function defineEffectAction<
  I extends TSchema | undefined = undefined,
  O extends TSchema | undefined = undefined,
  Errors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  C extends ActionContext = ActionContext,
  E = never,
  R = never,
>(
  config: EffectActionConfigWithAuthorize<I, O, Errors, C, E, R>,
): EffectAction<I, O, Errors, C, E, R>;

export function defineEffectAction<
  I extends TSchema | undefined = undefined,
  O extends TSchema | undefined = undefined,
  Errors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  C extends ActionContext = ActionContext,
  E = never,
  R = never,
>(
  config: EffectActionConfigWithoutAuthorize<I, O, Errors, C, E, R>,
): EffectAction<I, O, Errors, C, E, R>;

export function defineEffectAction(config: any): any {
  const adapted = adaptEffectActionConfig(config);
  return createAction(adapted, adapted[effectExecutionKey]);
}

/**
 * `defineTool` for Effect: an MCP tool whose `execute` returns an `Effect`.
 * It takes the options of `defineEffectAction` plus `title`, `annotations`, and
 * `http`. Imported as `defineTool` from `@brickkit/core/effect`.
 *
 * @param config - The tool configuration; `input` must be an object schema.
 * @returns The tool, to register with `service.tool(tool)`.
 * @throws When `input` is not an object schema.
 */
export function defineEffectTool<
  I extends TSchema | undefined = undefined,
  O extends TSchema | undefined = undefined,
  Errors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  C extends ActionContext = ActionContext,
  E = never,
  R = never,
>(
  config: EffectActionConfigWithAuthorize<I, O, Errors, C, E, R> & ToolOptions,
): EffectTool<I, O, Errors, C, E, R>;

export function defineEffectTool<
  I extends TSchema | undefined = undefined,
  O extends TSchema | undefined = undefined,
  Errors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  C extends ActionContext = ActionContext,
  E = never,
  R = never,
>(
  config: EffectActionConfigWithoutAuthorize<I, O, Errors, C, E, R> &
    ToolOptions,
): EffectTool<I, O, Errors, C, E, R>;

export function defineEffectTool(config: any): any {
  if (config.input && config.input.type !== "object")
    throw new Error(`Tool '${config.name}' input must be an object schema`);
  const tool = defineEffectAction(config);
  Object.defineProperty(tool, "kind", { value: "tool" });
  return tool;
}

export { defineEffectAction as defineAction, defineEffectTool as defineTool };
export {
  defineEffectService,
  defineEffectService as defineService,
  type EffectService,
  type EffectServiceOptions,
} from "./effect-service";
export { defineResource } from "./resource";
export {
  defineEffectServicePlugin,
  defineEffectServicePlugin as defineServicePlugin,
  defineEffectResourcePlugin,
  defineEffectResourcePlugin as defineResourcePlugin,
} from "./effect-plugin";
export {
  effectBrick,
  effectBrick as brick,
  type EffectBrickApp,
  type EffectServerOptions,
} from "./effect-server";
export { runEffectPromise } from "./effect-runtime";
export { t, Type } from "./typebox";
export { defineDatabase } from "./db";
export { createMcpHandler } from "./mcp";
export {
  createEffectServiceProxy,
  createEffectServiceProxy as createServiceProxy,
  createEffectMcpRegistry,
  createEffectMcpRegistry as createMcpRegistry,
  type EffectMcpRegistry,
} from "./effect-rpc";
