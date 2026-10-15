import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";

export class SlugTaken extends Schema.TaggedError<SlugTaken>()(
  "SlugTaken",
  { slug: Schema.String },
  { httpApiStatus: 409 },
) {}
export class Prefix extends Context.Service<Prefix, string>()("Prefix") {}
export class Auth extends HttpApiMiddleware.Service<Auth>()("Auth", {
  requiredForClient: true,
}) {}
export const Prefixed = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value: string) => Effect.map(Prefix, (prefix) => prefix + value),
      encode: (value: string) => Effect.succeed(value),
    }),
  ),
);
export const api = HttpApi.make("browser-contract")
  .add(
    HttpApiGroup.make("pages").add(
      HttpApiEndpoint.post("create", "/pages", {
        payload: Schema.Struct({ slug: Schema.String }),
        success: Schema.Struct({ slug: Schema.String }),
        error: SlugTaken,
      }),
      HttpApiEndpoint.get("count", "/count", { success: Schema.Number }),
    ),
  )
  .add(
    HttpApiGroup.make("system", { topLevel: true }).add(
      HttpApiEndpoint.get("ping", "/ping", { success: Schema.String }),
    ),
  );
export const securedApi = HttpApi.make("secured").add(
  HttpApiGroup.make("secure").add(
    HttpApiEndpoint.get("name", "/name", { success: Prefixed }).middleware(
      Auth,
    ),
  ),
);
