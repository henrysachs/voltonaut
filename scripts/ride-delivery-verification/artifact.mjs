import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { z } from "../../packages/shared/node_modules/zod/index.js";

/** @param {string | Readonly<Uint8Array>} bytes */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node Crypto accepts native typed-array buffers; hashing does not mutate them.
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {string} output @param {string} path */
async function hashFile(output, path) {
  const bytes = await readFile(join(output, path));

  if (/\.(?:js|html)$/u.test(path))
    assert.doesNotMatch(bytes.toString("utf8"), /\/@vite\/client|\/src\/main\.ts/u);

  return Object.freeze({ path, bytes: bytes.length, sha256: sha256(bytes) });
}

/** @param {{ readonly root: string; readonly artifacts: string; readonly output: string; readonly rerun: string }} options */
export async function buildWeb(options) {
  const { root, artifacts, output, rerun } = options;
  const config = join(artifacts, "vite.config.mjs");
  const web = join(root, "apps/web");

  await writeFile(
    config,
    `import base from ${JSON.stringify(join(web, "vite.config.ts"))};\nexport default { ...base, root: ${JSON.stringify(web)}, envDir: ${JSON.stringify(artifacts)}, cacheDir: ${JSON.stringify(join(artifacts, "vite-cache"))}, build: { ...base.build, outDir: ${JSON.stringify(output)}, emptyOutDir: true } };\n`,
  );

  const result = spawnSync(
    process.execPath,
    [join(web, "node_modules/vite/bin/vite.js"), "build", "--config", config],
    {
      cwd: web,
      env: {
        PATH: process.env["PATH"],
        HOME: process.env["HOME"],
        TMPDIR: process.env["TMPDIR"],
        NODE_ENV: "production",
        VITE_API_ORIGIN: "",
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );

  await writeFile(join(artifacts, "build.log"), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, "Actual application Vite build succeeds");
  const paths = (await readdir(output, { recursive: true })).toSorted();

  const files = await Promise.all(
    paths.flatMap((path) => (extname(path) === "" ? [] : [hashFile(output, path)])),
  );

  const workers = files.filter((file) => /(?:^|\/)engine-worker-[^/]+\.js$/u.test(file.path));
  assert.equal(workers.length, 1, "Build emits the actual engine Worker");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  await writeFile(
    join(artifacts, "build-manifest.json"),
    `${JSON.stringify({ head, rerun, files, workers }, null, 2)}\n`,
  );

  return workers;
}

const mime = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".wasm", "application/wasm"],
]);

/** @param {string} output @param {string} artifacts */
export async function serveBuild(output, artifacts) {
  const requests = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node owns HTTP request/response handles; this boundary serves only the owned build.
  const server = createServer((request, response) => {
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    void (async () => {
      const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      assert.doesNotMatch(path, /(?:\.(?:ts|tsx)$|^\/(?:@|src\/|node_modules\/))/u);
      const file = resolve(output, `.${extname(path) === "" ? "/index.html" : path}`);
      assert.ok(file.startsWith(`${output}${sep}`), "Static request remains inside built output");
      const content = await readFile(file);

      response.setHeader("Content-Type", mime.get(extname(file)) ?? "application/octet-stream");
      response.end(content);
      requests.push({ path, status: 200 });
    })().catch(() => {
      response.writeHead(404);
      response.end("Built artifact not found");
      requests.push({ path: request.url, status: 404 });
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = z.object({ port: z.number() }).parse(server.address());

  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((done) => {
        server.close(done);
      });
      await writeFile(
        join(artifacts, "static-requests.json"),
        `${JSON.stringify(requests, null, 2)}\n`,
      );
    },
  };
}
