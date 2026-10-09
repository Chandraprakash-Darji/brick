import path from "node:path";
import { fileURLToPath } from "node:url";

import { brickClient } from "@brickkit/cli/vite";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { SERVER_PRESET, startOptions } from "./app.config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    brickClient({ entry: "./src/api/app.ts" }),
    tailwindcss(),
    // MUST come before react()
    tanstackStart(startOptions),
    nitro({ preset: SERVER_PRESET }),
    react(),
  ],
  resolve: {
    // Mirrors tsconfig `paths` ("@/*" -> "src/*"), same as astro.config.mjs.
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5174,
  },
});
