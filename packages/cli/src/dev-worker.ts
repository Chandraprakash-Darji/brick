import { startDevApplication } from "./runner";
import { parsePort } from "./port-utils";

// Scan local imports so dependencies outside the app directory are watched too.
if (process.argv[5] && process.argv[2]) {
  const files = new Set<string>();
  try {
    await Bun.build({
      entrypoints: [process.argv[2]],
      target: "bun",
      packages: "external",
      plugins: [
        {
          name: "brick:dependencies",
          setup(build) {
            build.onLoad({ filter: /./ }, (args) => {
              files.add(args.path);
              return undefined;
            });
          },
        },
      ],
    });
  } finally {
    process.send?.({ type: "brick:dependencies", files: [...files] });
  }
}

await startDevApplication({
  entry: process.argv[2],
  port: parsePort(process.argv[3] || undefined, process.env.PORT),
  prefix: process.argv[4] || undefined,
  clientOutput: process.argv[5] || undefined,
});
