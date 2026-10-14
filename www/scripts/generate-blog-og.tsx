import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { z } from "zod";

const root = new URL("../", import.meta.url);
const output = new URL("public/og/blog/", root);
const postSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
});
const [regular, bold, logo] = await Promise.all([
  readFile(
    fileURLToPath(
      import.meta
        .resolve("@fontsource/geist/files/geist-latin-400-normal.woff"),
    ),
  ),
  readFile(
    fileURLToPath(
      import.meta
        .resolve("@fontsource/geist/files/geist-latin-700-normal.woff"),
    ),
  ),
  readFile(new URL("public/brand/logo.svg", root), "utf8"),
]);
const logoUrl = `data:image/svg+xml;base64,${Buffer.from(
  logo.replace('viewBox="0 0 1254 1254"', 'viewBox="183 150 889 924"'),
).toString("base64")}`;

await mkdir(output, { recursive: true });
for (const file of await readdir(new URL("content/blog/", root))) {
  if (!file.endsWith(".mdx")) continue;
  const { title, description } = postSchema.parse(
    matter(await readFile(new URL(`content/blog/${file}`, root), "utf8")).data,
  );
  const svg = await satori(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#F5F5F3",
        color: "#171716",
        padding: 64,
        fontFamily: "Geist",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 20,
          letterSpacing: 2,
          color: "#737373",
        }}
      >
        BRICK
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 72 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 700,
            gap: 28,
          }}
        >
          <div
            style={{
              fontSize: title.length > 100 ? 46 : title.length > 70 ? 54 : 64,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.08,
              lineClamp: 5,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 27,
              lineHeight: 1.35,
              color: "#737373",
              lineClamp: 3,
            }}
          >
            {description}
          </div>
        </div>
        <img src={logoUrl} width={240} height={250} />
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
  await writeFile(
    new URL(`${file.slice(0, -4)}.png`, output),
    new Resvg(svg).render().asPng(),
  );
}
