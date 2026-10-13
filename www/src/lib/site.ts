import corePackage from "../../../packages/core/package.json";
import { repoUrl } from "./shared";

export const site = {
  name: "Brick",
  url: "https://brick.rega.run",
  title: "Brick — High-Throughput TypeScript Platform",
  description:
    "High-Throughput, Logical-Monolith / Physical-Microservices TypeScript Platform powered by Bun, Elysia, TypeBox, and Drizzle ORM.",
  repo: repoUrl,
  version: corePackage.version,
};
