import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2023",
    outDir: "dist",
    rolldownOptions: {
      input: { ride: "index.html", ble: "debug/ble.html" },
    },
  },
});
