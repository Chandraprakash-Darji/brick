/**
 * Runtime re-exports for backwards compatibility (deprecated).
 * New code should import `brick`, `BrickApp`, and the compiler runtime
 * from `@brickkit/core`. This package is build-time tooling only.
 */
export {
  brick,
  type CreateServerOptions,
  type BrickApp,
  type EndpointContext,
  type EndpointDefinition,
  type EndpointLogger,
  type EndpointMethod,
  requestLoggingPlugin,
  type RequestLoggingOptions,
  scalarDocsHTML,
  referencePlugin,
  registerReferenceRoute,
  type ReferenceOptions,
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
} from "@brickkit/core";

export { startDevServer, type DevServerOptions } from "./runner";
export { buildApplication, type BuildApplicationOptions } from "./build";
export { generateClientContract } from "./client-contract";
export { emitCompiledApplication, emitHandlerFactory } from "./compiler/emit";
