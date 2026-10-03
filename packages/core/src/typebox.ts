import { Type, type TSchema, type Static } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { ValidationErrorItem } from "./types";

export { Type, Type as t };
export type { TSchema, Static };

const compilerCache = new WeakMap<TSchema, TypeCheck<TSchema>>();

export function getCompiledCheck<T extends TSchema>(schema: T): TypeCheck<T> {
  let compiled = compilerCache.get(schema) as TypeCheck<T> | undefined;
  if (!compiled) {
    compiled = TypeCompiler.Compile(schema);
    compilerCache.set(schema, compiled);
  }
  return compiled;
}

export function validateWithSchema<T extends TSchema>(
  schema: T | undefined,
  value: unknown
): { success: true; data: Static<T> } | { success: false; errors: ValidationErrorItem[] } {
  if (!schema) {
    return { success: true, data: value as Static<T> };
  }

  const check = getCompiledCheck(schema);
  if (check.Check(value)) {
    return { success: true, data: value as Static<T> };
  }

  const errors: ValidationErrorItem[] = [];
  for (const error of check.Errors(value)) {
    errors.push({
      path: error.path,
      message: error.message,
      value: error.value,
      type: error.type,
    });
  }

  return { success: false, errors };
}
