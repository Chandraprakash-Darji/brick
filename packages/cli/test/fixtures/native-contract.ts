import { Schema } from "effect";
import { HttpApi, HttpApiGroup } from "effect/http-api";
import { action, NotFound } from "@brickkit/core/contracts";

export const Echo = action("echo", "/native/echo", {
  input: Schema.Struct({ message: Schema.String }),
  output: Schema.String,
  errors: [NotFound],
});
export const Api = HttpApi.make("native-client").add(
  HttpApiGroup.make("pages").add(Echo.endpoint),
);
