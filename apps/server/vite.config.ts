import swc from "unplugin-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2023",
      },
      sourceMaps: true,
    }),
  ],
  build: {
    ssr: "src/main.ts",
    outDir: "dist",
    target: "node24",
    minify: false,
  },
});
