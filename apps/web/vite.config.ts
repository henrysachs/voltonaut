import { defineConfig } from "vite";
import type { IndexHtmlTransformContext } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "strava-finish-after-scrub",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler(html, context: Readonly<Pick<IndexHtmlTransformContext, "path">>) {
          if (context.path !== "/strava/finish/index.html") return html;

          return html.replaceAll(/<link rel="modulepreload"[^>]*>/gu, "").replace(
            /<script type="module" crossorigin src="([^"]+)"><\/script>/u,
            (_tag: string, src: string) => `<script>
                document.addEventListener("DOMContentLoaded", () => {
                  void import(${JSON.stringify(src)});
                }, { once: true });
              </script>`,
          );
        },
      },
    },
  ],
  build: {
    target: "es2023",
    outDir: "dist",
    rolldownOptions: {
      input: {
        ride: "index.html",
        ble: "debug/ble.html",
        stravaBridge: "strava/bridge/index.html",
        stravaFinish: "strava/finish/index.html",
      },
    },
  },
});
