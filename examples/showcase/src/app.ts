import { Brick } from "@brickkit/core";
import { Layer } from "effect";
import { usersService } from "./services/users";

export const app = Brick.app({ services: [usersService], layer: Layer.empty });
