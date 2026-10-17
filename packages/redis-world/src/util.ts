import { createDebugLogger } from "./internal/debug.js";

export { compact, Mutex, Rc } from "./internal/util.js";
// `parse`/`stringify` take a fast path that skips JSON's reviver/replacer when
// the payload holds no binary (~5x on parse, ~2x on stringify) with identical
// semantics.
export {
  hasBinary,
  parse,
  stringify,
  uint8ArrayReplacer,
} from "./internal/serialization.js";
export const debug = createDebugLogger("redis-world");
