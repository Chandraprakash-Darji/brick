import { startDevApplication } from "./runner";
import { parsePort } from "./port-utils";

await startDevApplication({
  entry: process.argv[2],
  port: parsePort(process.argv[3] || undefined, process.env.PORT),
});
