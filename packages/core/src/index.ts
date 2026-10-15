// Effect-native Brick: contracts, services, apps, and typed errors.
export { Brick } from "./native";
export { isNativeBrickApp, type NativeBrickApp } from "./native-app-entry";

// Secrets & environment variables
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
