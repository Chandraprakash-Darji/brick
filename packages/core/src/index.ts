// Core Primitives
export {
  defineService,
  ServiceImpl,
  mapColumnToManifestType,
  emitManifest,
  emitManifestJson,
} from "./service";
export { defineAction, buildErrorHelpers } from "./action";
export { defineResource, buildResourcePlan, installCompiledResourceGet, isNativeResourceReadAction, isNativeResourceAction } from "./resource";
export { createServiceProxy } from "./rpc";
export {
  ServiceRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from "./registry";

// TypeBox Schema Builders & Validators
export { Type, t, getCompiledCheck, validateWithSchema } from "./typebox";
export type { TSchema, Static } from "./typebox";

// OpenAPI 3.1 Specification Generation
export { generateOpenApiSpec } from "./openapi";
export type { OpenApiGeneratorOptions } from "./openapi";

// Database Integration
export * from "./db";

// Types & Errors
export * from "./types";

// Secrets & Environment Variables
export {
  secret,
  SecretRef,
  envSource,
  resolveSecrets,
  listSecrets,
  overrideSecret,
  overrideSecrets,
  resetSecrets,
} from "./secrets";
export type { SecretSource, SecretOptions } from "./secrets";
