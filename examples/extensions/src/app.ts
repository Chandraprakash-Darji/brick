import { Brick } from "@brickkit/core";
import { comments } from "./extensions/comments";
import { DatabaseLive } from "./database";

export function createApp() {
  const actions = comments();
  const pagesService = Brick.service("pages", { actions });
  const app = Brick.app({ services: [pagesService], layer: DatabaseLive });
  return { app, actions };
}
export const { app, actions } = createApp();
