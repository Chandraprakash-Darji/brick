import { action, app, compileService, layer, mount, service } from "./kernel";
import { endpoint } from "./contracts";
import { route } from "./route";
import { rpcGroup } from "./transports";
import * as errors from "./errors";

/** Effect-native contracts and scoped HTTP applications. */
export const Brick = Object.freeze({
  action,
  endpoint,
  service,
  app,
  compileService,
  layer,
  mount,
  errors,
  rpcGroup,
  route,
});
export * from "./errors";
export type {
  ActionConstraint,
  Requirements,
  ServiceConstraint,
} from "./kernel";
