import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    modulePreload: false,
    rolldownOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        background: resolve(import.meta.dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (asset) =>
          asset.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
