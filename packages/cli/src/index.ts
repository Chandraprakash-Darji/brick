export { brick, createBrickServer, type CreateServerOptions } from "./server";
export {
  type BrickApp,
  type EndpointContext,
  type EndpointDefinition,
  type EndpointLogger,
  type EndpointMethod,
} from "./endpoints";
export { startDevServer, type DevServerOptions } from "./runner";
export {
  requestLoggingPlugin,
  type RequestLoggingOptions,
} from "./request-logger";
export {
  scalarDocsHTML,
  referencePlugin,
  registerReferenceRoute,
  type ReferenceOptions,
} from "./docs";

export {
  compileBrickApplication,
  bindCompiledApplication,
  emitCompiledApplication,
  type BrickIR,
  type RouteIR,
  type CompiledApplication,
} from "./compiler";
export { buildApplication, type BuildApplicationOptions } from "./build";
