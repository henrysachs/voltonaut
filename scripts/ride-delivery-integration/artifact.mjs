/// <reference types="node" />
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { z } from "../../packages/shared/node_modules/zod/index.js";

const sourcePaths = [
  "apps/web/src",
  "apps/web/index.html",
  "apps/web/strava",
  "apps/web/public",
  "apps/server/src",
  "apps/server/drizzle",
  "packages",
  "scripts/ride-delivery-integration",
  "scripts/verify-browser-sync-control.mjs",
  "apps/web/verification/ride-delivery-integration*",
  "apps/web/vite.config.ts",
  "apps/server/vite.config.ts",
  "apps/web/e2e/helpers/nativeControl.ts",
  "apps/web/e2e/helpers/gameMenu.ts",
  "pnpm-lock.yaml",
  "package.json",
  "apps/web/package.json",
  "apps/server/package.json",
];

/** @param {string | Readonly<Uint8Array>} value */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Crypto consumes native buffers without mutation.
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} directory */
export async function hashTree(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });

  const paths = [];

  for (const entry of entries) {
    if (entry.isFile()) paths.push(join(entry.parentPath, entry.name));
  }

  return Promise.all(
    paths.map(async (file) => {
      const bytes = await readFile(file);

      return Object.freeze({
        path: relative(directory, file),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }),
  );
}

/** @param {{readonly root: string; readonly artifacts: string; readonly rerun: string}} options */
export async function manifestSource(options) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...sourcePaths],
    { cwd: options.root, encoding: "utf8" },
  )
    .trim()
    .split("\n");

  const source = await Promise.all(
    [...new Set(files)].map(async (file) => {
      const bytes = await readFile(join(options.root, file));

      return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  );

  await writeFile(
    join(options.artifacts, "source-manifest.json"),
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: options.root,
          encoding: "utf8",
        }).trim(),
        mergeHead: mergeHead(options.root),
        workingTree: execFileSync("git", ["status", "--short"], {
          cwd: options.root,
          encoding: "utf8",
        }),
        source,
        rerun: options.rerun,
      },
      null,
      2,
    ),
  );
}

/** @param {string} root */
function mergeHead(root) {
  const result = spawnSync("git", ["rev-parse", "--verify", "MERGE_HEAD"], {
    cwd: root,
    encoding: "utf8",
  });

  return result.status === 0 ? result.stdout.trim() : null;
}

/** @param {string} root @param {string} artifacts */
export async function verifySourceManifest(root, artifacts) {
  const manifest = z
    .object({ source: z.array(z.object({ path: z.string(), sha256: z.string() }).readonly()) })
    .parse(JSON.parse(await readFile(join(artifacts, "source-manifest.json"), "utf8")));

  const checks = await Promise.all(
    manifest.source.map(async (file) =>
      Object.freeze({
        path: file.path,
        unchanged: sha256(await readFile(join(root, file.path))) === file.sha256,
      }),
    ),
  );

  await writeFile(join(artifacts, "source-stability.json"), JSON.stringify(checks, null, 2));
  assert.ok(
    checks.every((file) => file.unchanged),
    "Source changed during this run; retained artifact is not a proof of current source",
  );
}

/** @param {readonly string[]} args @param {string} cwd @param {string} name @param {string} artifacts @param {string} api */
export async function runBuild(args, cwd, name, artifacts, api) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      TMPDIR: process.env["TMPDIR"],
      NODE_ENV: "production",
      VITE_API_ORIGIN: api,
    },
    encoding: "utf8",
    timeout: 120_000,
  });

  await writeFile(join(artifacts, `${name}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name} succeeds; inspect retained log`);
}

/** @param {{readonly output: string; readonly port: number; readonly origin: string; readonly artifacts: string}} options */
export async function serveBuild(options) {
  const requests = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Static HTTP serving retains Node's native handles.
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", options.origin).pathname;

      assert.doesNotMatch(path, /(?:\.(?:ts|tsx)$|^\/(?:@|src\/|node_modules\/))/u);

      const file = resolve(options.output, `.${builtPath(path)}`);

      assert.ok(file.startsWith(`${options.output}${sep}`));
      const bytes = await readFile(file);

      response.writeHead(200, {
        "Content-Type": contentType(file),
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
      response.end(bytes);
      requests.push({ path, status: 200 });
    })().catch(() => {
      response.writeHead(404);
      response.end("Built artifact not found");
      requests.push({ path: request.url, status: 404 });
    });
  });

  server.listen(options.port, "127.0.0.1");
  await once(server, "listening");

  return {
    async close() {
      server.closeAllConnections();
      await new Promise((done) => {
        server.close(done);
      });
      await writeFile(
        join(options.artifacts, "static-requests.json"),
        JSON.stringify(requests, null, 2),
      );
    },
  };
}

/** @param {string} path */
function builtPath(path) {
  if (path === "/" || path === "/auth/finish") return "/index.html";

  return extname(path) === "" ? `${path.replace(/\/$/u, "")}/index.html` : path;
}

/** @param {string} file */
function contentType(file) {
  const mime = new Map([
    [".html", "text/html"],
    [".js", "text/javascript"],
    [".css", "text/css"],
    [".json", "application/json"],
    [".svg", "image/svg+xml"],
    [".wasm", "application/wasm"],
  ]);

  return mime.get(extname(file)) ?? "application/octet-stream";
}
