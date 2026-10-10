// Service & resource plugins (e.g. `@brickkit/crud`).
export {
  defineServicePlugin,
  defineResourcePlugin,
  getPluginActionRoute,
  getPluginEndpoints,
} from "./plugin";
export type {
  ServicePlugin,
  ResourcePlugin,
  ServicePluginContext,
  ResourcePluginContext,
  ResourcePluginTypes,
  ResourcePluginAPI,
  PluginRouteRegistrar,
  PluginRoutes,
  PluginRouteScope,
  PluginRouteMethod,
  PluginEndpointContext,
} from "./plugin";
// HTTP Runtime (Elysia app): bundled to user apps, never the CLI.
export { brick, type CreateServerOptions } from "./server";
export {
  type BrickApp,
  type EndpointContext,
  type EndpointDefinition,
  type EndpointLogger,
  type EndpointMethod,
  resolveEndpointDb,
  createEndpointHandler,
  toOpenApiPath,
  endpointPaths,
} from "./endpoints";
export {
  compileRoutePlan,
  executeCompiledRoute,
  createActionHandler,
} from "./action-handler";
export { isBrickApp, requireBrickApp } from "./app-entry";
export {
  requestLoggingPlugin,
  type RequestLoggingOptions,
} from "./request-logger";
export {
  scalarDocsHTML,
  swaggerDocsHTML,
  referencePlugin,
  registerReferenceRoute,
  type ReferenceOptions,
} from "./docs";
export {
  compileBrickApplication,
  bindCompiledApplication,
  loadCompiledBrickApp,
  type BrickIR,
  type RouteIR,
  type RouteMethod,
  type CompiledApplication,
  type CompiledRoute,
  type CompiledHandler,
  type HandlerFactory,
} from "./compiler";
export { emitHandlerFactory } from "./compiler/emit";
export { compilerRuntime } from "./compiler/runtime";

// Core Primitives
export { defineService, ServiceImpl } from "./service";
export { defineAction, buildErrorHelpers } from "./action";
export { defineResource } from "./resource";
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
  BrickClientAction,
  BrickCallOptions,
  BrickActionCaller,
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
