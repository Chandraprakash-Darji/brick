import { brick, definePlugin, defineService } from "@brickkit/core";

// A plugin whose dashboard extension does not build.
const broken = definePlugin({
  name: "@acme/brick-broken",
  dashboard: "./plugin-dashboard/broken.tsx",
  app: () => {},
});
export default brick({
  services: [defineService("broken-plugin-host")],
  requestLogging: false,
  plugins: [broken()],
});
