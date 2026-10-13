import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    {
      name: "docs-markdown-routes",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          // Nitro otherwise treats .md routes as static assets in development.
          if (request.url?.split(/[?#]/, 1)[0].match(/^\/docs\/.*\.md$/)) {
            request.headers.accept = `${request.headers.accept ?? "*/*"}, text/html;q=0`;
          }
          next();
        });
      },
    },
    mdx(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        // Docs need the request's Accept header; static HTML bypasses middleware.
        filter: (page) =>
          page.path !== "/docs" && !page.path.startsWith("/docs/"),
      },
    }),
    react(),
    nitro({
      preset: "vercel",
      // @ts-expect-error nitro runtime trace configuration
      externals: {
        inline: ["tslib"],
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
