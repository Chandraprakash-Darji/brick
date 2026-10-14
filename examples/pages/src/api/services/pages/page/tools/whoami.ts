import { Effect } from "effect";
import { t } from "@brickkit/core";

import { pagesService } from "../service";
import { requireUser } from "./_shared";

export const whoamiTool = pagesService.tool({
  annotations: { readOnlyHint: true },
  title: "View Connected Account",
  authorize: requireUser,
  description:
    "Returns the authenticated subject (user ID) of the current bearer token.",
  execute: ({ ctx }) =>
    Effect.tryPromise({
      try: async () => {
        const userId = (ctx as unknown as { user: { id: string } }).user.id;
        return `You are authenticated as ${userId}`;
      },
      catch: (failure) => failure,
    }),
  input: t.Object({}, { additionalProperties: false }),
  name: "whoami",
  output: t.String(),
});
