import { Effect, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { Unauthorized, InternalServerError } from "@brickkit/core/contracts";
import { requireMcpAuth } from "@better-auth/mcp";
import { Auth } from "./auth";
import { mcpResourceSecret } from "./secrets";
const Subject = Schema.Struct({ subject: Schema.String });
export const requireUser = Effect.gen(function* () {
  const auth = yield* Auth;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request).pipe(
    Effect.mapError(() => new Unauthorized({ message: "Invalid request" })),
  );
  const session = yield* Effect.tryPromise({
    try: () => auth.api.getSession({ headers: web.headers }),
    catch: () => new InternalServerError({ message: "Session lookup failed" }),
  });
  if (session?.user) return session.user.id;
  if (web.headers.has("authorization")) {
    const response = yield* Effect.tryPromise({
      try: () =>
        requireMcpAuth(
          auth,
          (_request, claims) => Response.json({ subject: claims.sub }),
          { resource: mcpResourceSecret.require() },
        )(web),
      catch: () => new Unauthorized({ message: "Invalid bearer token" }),
    });
    if (response.ok) {
      const json = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new Unauthorized({ message: "Invalid bearer token" }),
      });
      return (yield* Schema.decodeUnknownEffect(Subject)(json).pipe(
        Effect.mapError(
          () => new Unauthorized({ message: "Invalid bearer token" }),
        ),
      )).subject;
    }
  }
  return yield* Effect.fail(
    new Unauthorized({ message: "Active session required" }),
  );
});
