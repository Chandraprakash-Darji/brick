/**
 * What the host process hands the inspector: the world to read. Brick change: upstream resolves the world from
 * `WORKFLOW_TARGET_WORLD` and friends; here the host passes its own.
 */
import type { World } from "@workflow/world";

export interface InspectorHost {
  world: World;
}

let host: InspectorHost | undefined;

export function setInspectorHost(next: InspectorHost): void {
  host = next;
}

export function getInspectorHost(): InspectorHost {
  if (!host) throw new Error("The workflow inspector has no world to read.");
  return host;
}
