import { t } from "@brickkit/core";

import { pagesService } from "../service";
import { requireUser } from "./_shared";

export const echoTool = pagesService.tool({
  title: "Echo Message",
  http: true,
  authorize: requireUser,
  description:
    "Connectivity test — echoes back the message you send. Returns the message prefixed with 'Echo:' and the authenticated user's ID.",
  execute: async ({ input, ctx }) => {
    const userId = (ctx as unknown as { user: { id: string } }).user.id;
    // Under `brick dev` this shows in the dashboard's Logs tab and in the
    // request's own details, not in the terminal.
    ctx.logger.info("echoing a message", {
      userId,
      length: input.message.length,
    });
    if (input.message.length > 40) ctx.logger.warn("a long message");
    return `Echo: ${input.message} (for user ${userId})`;
  },
  input: t.Object({ message: t.String() }, { additionalProperties: false }),
  name: "echo",
  output: t.String(),
});
