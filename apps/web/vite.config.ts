import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig } from "vite";
import type { IndexHtmlTransformContext, Plugin } from "vite";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Rollup passes its own mutable bundle and chunk objects to plugin hooks.

const SERVICE_WORKER_ENTRY = "sw";

const STATIC_PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

// Public files (manifest, icons, models) are cached under fixed URLs, so their bytes
// must change the release version; hashed build files already do through their names.
function hashPublicFiles(hash: Hash, publicDir: string): void {
  if (publicDir === "") return;

  const files = readdirSync(publicDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();

  for (const file of files) hash.update(relative(publicDir, file)).update(readFileSync(file));
}

// Emits /sw.js with a release version and the list of hashed build files to precache.
// Hashed asset names change with their content, so the version changes with every release.
function serviceWorkerManifest(): Plugin {
  let publicDir = "";

  return {
    name: "service-worker-manifest",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const worker = Object.values(bundle).find(
        (file) => file.type === "chunk" && file.name === SERVICE_WORKER_ENTRY,
      );

      if (worker?.type !== "chunk") throw new Error("Missing service worker entry");

      if (worker.imports.length > 0 || worker.dynamicImports.length > 0) {
        throw new Error("The service worker bundle must be self-contained");
      }

      const builtFiles = Object.keys(bundle)
        .filter((name) => name.startsWith("assets/") && /\.(?:js|css)$/u.test(name))
        .toSorted();

      const index = bundle["index.html"];
      const indexSource = index?.type === "asset" ? String(index.source) : "";

      const hash = createHash("sha256").update(indexSource).update(builtFiles.join("\n"));

      hashPublicFiles(hash, publicDir);

      const version = hash.digest("hex").slice(0, 12);

      const precache = [...STATIC_PRECACHE, ...builtFiles.map((name) => `/${name}`)];

      worker.code = worker.code
        .replace("__VOLTONAUT_VERSION__", version)
        .replace("__VOLTONAUT_PRECACHE__", precache.join(","));
      worker.fileName = "sw.js";
    },
  };
}

export default defineConfig({
  plugins: [
    serviceWorkerManifest(),
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
        [SERVICE_WORKER_ENTRY]: "src/pwa/serviceWorker.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === SERVICE_WORKER_ENTRY ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
