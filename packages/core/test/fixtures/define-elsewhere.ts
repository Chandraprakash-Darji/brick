import { defineService } from "../../src";

// try/finally keeps this file's frame on the stack: a tail call would drop it.

/** Defines on `service` from this file, so a test can collide across files. */
export function defineElsewhere(
  service: any,
  kind: "action" | "tool" | "socket" | "resource",
  config: any,
) {
  try {
    return service[kind](config);
  } finally {
  }
}

export function defineServiceElsewhere(name: string) {
  try {
    return defineService(name);
  } finally {
  }
}
