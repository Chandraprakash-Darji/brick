import { brick, defineService, t } from "@brickkit/core";

const service = defineService("socket_fixture");
service.socket({
  name: "live",
  allowMissingOrigin: true,
  input: { echo: t.String() },
  output: { echoed: t.String() },
  handlers: { echo: ({ input, socket }) => socket.send("echoed", input) },
});
export default brick({
  services: [service],
  prefix: "/v2",
  docs: false,
  requestLogging: false,
});
