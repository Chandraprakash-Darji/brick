/**
 * Backwards-compatible compiler entry. New code should import the runtime
 * (`compileBrickApplication`, `bindCompiledApplication`,
 * `loadCompiledBrickApp`) from `@brickkit/core` and the build-time emitter
 * (`emitCompiledApplication`) from here.
 */
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
} from "@brickkit/core";
export { emitCompiledApplication, emitHandlerFactory } from "./compiler/emit";
