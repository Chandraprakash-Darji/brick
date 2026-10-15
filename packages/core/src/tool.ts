import type { TSchema } from "@sinclair/typebox";
import { defineAction } from "./action";
import type {
  Tool,
  ToolConfigWithAuthorize,
  ToolConfigWithoutAuthorize,
  ActionErrorDefinition,
  ActionContext,
} from "./types";

export function defineTool<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
>(
  config: ToolConfigWithAuthorize<
    TInputSchema,
    TOutputSchema,
    TErrors,
    TContext
  >,
): Tool<TInputSchema, TOutputSchema, TErrors, TContext>;

export function defineTool<
  TInputSchema extends TSchema | undefined = undefined,
  TOutputSchema extends TSchema | undefined = undefined,
  TErrors extends Record<string, ActionErrorDefinition> = Record<
    string,
    ActionErrorDefinition
  >,
  TContext extends ActionContext = ActionContext,
>(
  config: ToolConfigWithoutAuthorize<
    TInputSchema,
    TOutputSchema,
    TErrors,
    TContext
  >,
): Tool<TInputSchema, TOutputSchema, TErrors, TContext>;

export function defineTool(config: any): any {
  if (config.input && config.input.type !== "object") {
    throw new Error(`Tool '${config.name}' input must be an object schema`);
  }
  const tool = defineAction(config);
  Object.defineProperty(tool, "kind", { value: "tool" });
  return tool;
}

export function isTool(value: unknown): value is Tool<any, any, any, any> {
  return typeof value === "function" && (value as Tool).kind === "tool";
}
