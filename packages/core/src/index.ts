// Core Primitives
export { defineService, ServiceImpl } from "./service";
export { defineAction, buildErrorHelpers } from "./action";
export {
  defineResource,
  buildResourcePlan,
  describeResourceReads,
  prepareResourceReads,
  prepareResourceWrites,
  type ResourceReadQueries,
} from "./resource";
export { createServiceProxy } from "./rpc";

// Typed HTTP Client (also importable as `@brickkit/core/client` for frontends)
export {
  createBrickClient,
  BrickTransportError,
  BrickServerError,
  isBrickTransportError,
  isBrickServerError,
} from "./client";
export type {
  BrickClient,
  BrickClientOptions,
  BrickCallOptions,
  BrickActionCaller,
  BrickResourceClient,
  InferActionInput,
  InferActionOutput,
  InferActionErrorCodes,
  InferActionFailure,
} from "./client";
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

export { defineTool, isTool } from "./tool";
export { createMcpRegistry, createMcpHandler, UnknownToolError } from "./mcp";
export type {
  McpToolDefinition,
  McpRegistry,
  McpRegistryOptions,
  McpHandlerOptions,
} from "./mcp";
