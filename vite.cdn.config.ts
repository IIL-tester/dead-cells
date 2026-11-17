import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "cdn",
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: "src/main.ts",
      name: "DeadCellsWebPort",
      formats: ["iife"],
      fileName: () => "dead-cells.js",
    },
  },
});
