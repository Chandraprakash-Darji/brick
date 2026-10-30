import { brick, definePlugin, defineService } from "@brickkit/core";

// A plugin that ships a dashboard extension, for `brick build`.
const comments = definePlugin({
  name: "@acme/brick-comments",
  dashboard: "./plugin-dashboard/index.tsx",
  app: () => {},
});
export default brick({
  services: [defineService("plugin-host")],
  requestLogging: false,
  plugins: [comments()],
});
