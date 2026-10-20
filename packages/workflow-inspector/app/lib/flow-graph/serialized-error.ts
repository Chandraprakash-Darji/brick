export function readSerializedError(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return { message: value };
  if (typeof value !== "object") return { message: "Unknown error" };

  return {
    message:
      "message" in value && typeof value.message === "string"
        ? value.message
        : "Unknown error",
    stack:
      "stack" in value && typeof value.stack === "string"
        ? value.stack
        : undefined,
    code:
      "code" in value && typeof value.code === "string"
        ? value.code
        : undefined,
  };
}
