import { HttpApi } from "effect/http-api";
import type { app } from "./native/kernel";

export type NativeBrickApp = ReturnType<typeof app>;

export function isNativeBrickApp(value: unknown): value is NativeBrickApp {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "brick-native-app" &&
    "fetch" in value &&
    typeof value.fetch === "function" &&
    "ready" in value &&
    typeof value.ready === "function" &&
    "dispose" in value &&
    typeof value.dispose === "function" &&
    "api" in value &&
    HttpApi.isHttpApi(value.api) &&
    "services" in value &&
    Array.isArray(value.services) &&
    "openApi" in value &&
    typeof value.openApi === "function"
  );
}
