// Core Primitives
export { defineService, ServiceImpl } from "./service";
export { defineAction } from "./action";
export { createServiceProxy } from "./rpc";
export {
  ServiceRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from "./registry";

// TypeBox Schema Builders & Validators
export { Type, t, getCompiledCheck, validateWithSchema } from "./typebox";
export type { TSchema, Static } from "./typebox";

// Database Integration
export * from "./db";

// Types & Errors
export * from "./types";
