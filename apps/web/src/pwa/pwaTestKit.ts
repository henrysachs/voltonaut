import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { build } from "vite";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Node http and Playwright handles are mutable by contract.
const TYPES = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".webmanifest", "application/manifest+json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

export interface Listening {
  readonly server: Server;
  readonly origin: string;
}

export async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Listening> {
  const server = createServer(handler);

  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done);
  });

  const address = server.address();

  assert.ok(address !== null && address instanceof Object, "missing test port");

  return { server, origin: `http://127.0.0.1:${address.port}` };
}

export async function stop(listening: Listening): Promise<void> {
  listening.server.closeAllConnections();
  await new Promise<void>((done) => {
    listening.server.close(() => {
      done();
    });
  });
}

async function readFileOrNull(path: string): Promise<Buffer | null> {
  try {
    return (await stat(path)).isFile() ? await readFile(path) : null;
  } catch {
    return null;
  }
}

export function serveDist(dist: string) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = pathname === "/" ? "index.html" : pathname;

    void readFileOrNull(resolve(dist, `.${join("/", file)}`)).then((body) => {
      response.writeHead(body === null ? 404 : 200, {
        "Content-Type": TYPES.get(extname(file)) ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      response.end(body);

      return body;
    });
  };
}

export async function buildProduction(publicDir?: string): Promise<string> {
  const dist = join(await mkdtemp(join(tmpdir(), "voltonaut-pwa-")), "dist");
  const nodeEnv = process.env["NODE_ENV"];

  // Vitest runs with NODE_ENV=test, which would build without the production-only
  // service worker registration.
  process.env["NODE_ENV"] = "production";

  try {
    await build({
      root: resolve(import.meta.dirname, "../.."),
      publicDir: publicDir ?? resolve(import.meta.dirname, "../../public"),
      build: { outDir: dist },
    });
  } finally {
    process.env["NODE_ENV"] = nodeEnv ?? "test";
  }

  return dist;
}

export function fetchApi(page: Page, url: string): Promise<string> {
  return page.evaluate(
    (target) =>
      fetch(target, { headers: { Authorization: "Bearer secret-session-token" } }).then(
        (response) => response.text(),
        () => "network error",
      ),
    url,
  );
}

export function cacheContents(page: Page): Promise<{ names: string[]; urls: string[] }> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const opened = await Promise.all(names.map((name) => caches.open(name)));
    const requests = await Promise.all(opened.map((cache) => cache.keys()));

    return { names, urls: requests.flat().map((request) => request.url) };
  });
}

export function startApi(requests: string[]): Promise<Listening> {
  return listen((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization",
    });
    response.end(JSON.stringify({ session: "secret-session-token", heartRateBpm: 150 }));
  });
}
