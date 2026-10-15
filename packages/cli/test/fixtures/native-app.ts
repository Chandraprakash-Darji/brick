import { Effect, Layer } from "effect";
import { Brick } from "@brickkit/core";
import { NotFound } from "@brickkit/core/contracts";
import { Echo } from "./native-contract";

const pages = Brick.service("pages", {
  actions: {
    echo: Echo((input) =>
      input.message === "missing"
        ? Effect.fail(new NotFound({ message: "No such message" }))
        : Effect.succeed(input.message),
    ),
  },
});

export default Brick.app({
  services: [pages],
  layer: Layer.empty,
  docs: { path: "/reference" },
  client: { module: "./native-contract" },
});
