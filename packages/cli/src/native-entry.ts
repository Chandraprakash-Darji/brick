/** Native runtime entry point: importing this module does not load Elysia. */
export { createNativeWorker, type NativeWorker } from "./native-worker";
export { startInProcessHttp } from "./native-bridge";
export { compilePlans, loadPlans, type CompiledPlans } from "./plans";
export type { CreateServerOptions } from "./server";
export type { EndpointDefinition, EndpointContext } from "./endpoints";
