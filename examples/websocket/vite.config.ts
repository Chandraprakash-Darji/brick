import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": { target: "http://localhost:4000", ws: true },
      "/session": { target: "http://localhost:4000" },
    },
  },
});
