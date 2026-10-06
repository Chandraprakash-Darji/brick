export interface BridgeHeader { name: string; value: string }
export interface BridgeRequest {
  bindingId: number; method: string; url: string; headers: BridgeHeader[];
  params: string; query: string; body: Uint8Array; input?: string;
  inputValidated: boolean; outputValidated: boolean;
}
export interface BridgeResponse { status: number; headers: BridgeHeader[]; body: Uint8Array; json: boolean }

/** Conservative JSON Schema subset whose semantics match the TypeBox JSON checks. */
export function supportsNativeSchema(schema: any): boolean {
  if (schema === undefined) return true;
  if (typeof schema === "boolean") return true;
  if (!schema || typeof schema !== "object") return false;
  const kind = schema[Symbol.for("TypeBox.Kind")];
  if (kind && !["Object", "Array", "String", "Number", "Integer", "Boolean", "Null", "Literal", "Union", "Intersect"].includes(kind)) return false;
  if (schema[Symbol.for("TypeBox.Transform")]) return false;
  const keywords = new Set(["type", "properties", "required", "additionalProperties", "items", "anyOf", "allOf", "const", "enum",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems",
    "title", "description", "default", "examples", "$id"]);
  if (Object.keys(schema).some(key => !keywords.has(key))) return false;
  if (schema.properties && !Object.values(schema.properties).every(supportsNativeSchema)) return false;
  if (schema.items && (Array.isArray(schema.items) || !supportsNativeSchema(schema.items))) return false;
  if (schema.additionalProperties && typeof schema.additionalProperties === "object" && !supportsNativeSchema(schema.additionalProperties)) return false;
  for (const keyword of ["anyOf", "allOf"]) if (schema[keyword] && !schema[keyword].every(supportsNativeSchema)) return false;
  return true;
}
