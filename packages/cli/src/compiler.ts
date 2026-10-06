import { type Service, prepareResourceReads, prepareResourceWrites } from "@elregaldo/core";
import { compileRoutePlan, executeCompiledRoute } from "./action-handler";
import { analyzeApplication, freezeIR, type BrickIR, type RouteIR } from "./compiler/ir";
import { emitHandlerFactory } from "./compiler/emit";
import { compilerRuntime, type CompiledHandler, type HandlerFactory } from "./compiler/runtime";

export { emitCompiledApplication, emitHandlerFactory } from "./compiler/emit";
export type { BrickIR, RouteIR, RouteMethod } from "./compiler/ir";
export type { CompiledHandler, HandlerFactory } from "./compiler/runtime";
export interface CompiledRoute { readonly ir: RouteIR; readonly handler: CompiledHandler; }
export interface CompiledApplication { readonly ir: BrickIR; readonly routes: readonly CompiledRoute[]; }

function bindAnalyzed(ir: BrickIR, bindings: ReturnType<typeof analyzeApplication>["bindings"], factories: readonly HandlerFactory[]): CompiledApplication {
  if (factories.length !== ir.routes.length) throw new Error("Brick compiler: handler factory count does not match IR");
  const routes = ir.routes.map((route, index) => {
    const { service, action } = bindings[index]!;
    const plan = Object.freeze(compileRoutePlan(service, action, route.path, route.method));
    const handler = factories[index]!(plan, compilerRuntime);
    return Object.freeze({ ir: route, handler });
  });
  return Object.freeze({ ir: freezeIR(ir), routes: Object.freeze(routes) });
}

/** Startup compiler: analyzes once, generates JS once, then binds live callbacks. */
export function compileBrickApplication(options: { services: Service<any, any>[]; prefix?: string; mode?: "specialized" | "generic" }): CompiledApplication {
  const { ir, bindings } = analyzeApplication(options.services, options.prefix);
  const factories: HandlerFactory[] = options.mode === "generic"
    ? ir.routes.map(() => (plan => context => executeCompiledRoute(plan, context)))
    : ir.routes.map(route => new Function(`return (${emitHandlerFactory(route)});`)() as HandlerFactory);
  if (options.mode !== "generic") for (const service of options.services) { prepareResourceReads(service); prepareResourceWrites(service); }
  return bindAnalyzed(ir, bindings, factories);
}

/** Build artifact binder: consumes emitted functions, with no runtime handler code generation. */
export function bindCompiledApplication(ir: BrickIR, services: Service<any, any>[], factories: readonly HandlerFactory[]): CompiledApplication {
  if (ir.version !== 1 || ir.target !== "bun-elysia") throw new Error("Brick compiler: unsupported IR version or target; rebuild the application");
  const analyzed = analyzeApplication(services, ir.prefix);
  if (JSON.stringify(analyzed.ir) !== JSON.stringify(ir)) throw new Error("Brick compiler: application definitions differ from the compiled IR; rebuild the application");
  for (const service of services) { prepareResourceReads(service); prepareResourceWrites(service); }
  return bindAnalyzed(ir, analyzed.bindings, factories);
}
