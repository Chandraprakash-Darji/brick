import { Kind, TransformKind, type TSchema } from "@sinclair/typebox";

const kinds = new Set([
  "Array",
  "Boolean",
  "Integer",
  "Intersect",
  "Literal",
  "Never",
  "Null",
  "Number",
  "Object",
  "Ref",
  "Record",
  "String",
  "This",
  "Tuple",
  "Union",
]);

/** Keep validators browser-safe and reject schemas whose behavior cannot cross JSON. */
export function serializeSocketSchema(schema: TSchema): unknown {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    if (TransformKind in value)
      throw new Error("Socket schemas cannot contain transforms");
    const entries = Object.entries(value).map(([key, child]) => [
      key,
      visit(child),
    ]);
    if (Kind in value) {
      if (typeof value[Kind] !== "string" || !kinds.has(value[Kind]))
        throw new Error("Socket schemas must describe JSON values");
      if ("format" in value || "__brick_kind" in value)
        throw new Error(
          "Socket schemas cannot contain formats or reserved __brick_kind annotations",
        );
      entries.push(["__brick_kind", value[Kind]]);
    }
    return Object.fromEntries(entries);
  };
  return visit(schema);
}

export function restoreSocketSchema(value: unknown): TSchema {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const kind =
      "__brick_kind" in node &&
      typeof node.__brick_kind === "string" &&
      kinds.has(node.__brick_kind)
        ? node.__brick_kind
        : undefined;
    const result = Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !kind || key !== "__brick_kind")
        .map(([key, child]) => [key, visit(child)]),
    );
    if (kind) Object.defineProperty(result, Kind, { value: kind });
    return result;
  };
  const schema = visit(value);
  if (!schema || typeof schema !== "object" || !(Kind in schema))
    throw new Error("Invalid socket contract schema");
  // Only generated, checked schema descriptions reach this boundary.
  return schema as TSchema;
}

export function isSocketEnvelope(
  value: unknown,
): value is { event: string; data: unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "event" in value &&
    typeof value.event === "string" &&
    "data" in value &&
    Object.keys(value).length === 2
  );
}

/** `prefix:value`, at most 200 bytes, without control characters. */
export function isSocketRoom(value: unknown): value is string {
  return (
    typeof value === "string" &&
    // eslint-disable-next-line no-control-regex
    /^[A-Za-z][\w-]*:[^\u0000-\u001f\u007f]+$/.test(value) &&
    new TextEncoder().encode(value).byteLength <= 200
  );
}

/** A replay sequence: `<number>-<number>`, the shape of a Redis stream id, then `.` and the server's signature for its room. */
export function isSocketSeq(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{1,20}-\d{1,20}\.[\w-]{22}$/.test(value)
  );
}

export function compareSocketSeq(a: string, b: string): number {
  const [a1, a2] = a.split(".")[0]!.split("-").map(BigInt) as [bigint, bigint];
  const [b1, b2] = b.split(".")[0]!.split("-").map(BigInt) as [bigint, bigint];
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  return a2 === b2 ? 0 : a2 > b2 ? 1 : -1;
}

export const SOCKET_MAX_BYTES = 64 * 1024;
export const SOCKET_BUFFER_BYTES = 1024 * 1024;
