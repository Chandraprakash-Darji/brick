import { t } from "@brickkit/core";

import { pagesService } from "../service";
import { requireUser } from "./_shared";

export const echoTool = pagesService.action({
  authorize: requireUser,
  description:
    "Connectivity test — echoes back the message you send. Returns the message prefixed with 'Echo:' and the authenticated user's ID.",
  execute: async ({ input, ctx }) => {
    const userId = (ctx as unknown as { user: { id: string } }).user.id;
    return `Echo: ${input.message} (for user ${userId})`;
  },
  input: t.Object({ message: t.String() }, { additionalProperties: false }),
  name: "echo",
  output: t.String(),
});
