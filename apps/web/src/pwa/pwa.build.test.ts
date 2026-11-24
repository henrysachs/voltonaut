import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Node http and Playwright handles are mutable by contract.
const TYPES = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".webmanifest", "application/manifest+json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

interface Listening {
  readonly server: Server;
  readonly origin: string;
}

async function listen(
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

async function stop(listening: Listening): Promise<void> {
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

function serveDist(dist: string) {
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

async function buildProduction(): Promise<string> {
  const dist = join(await mkdtemp(join(tmpdir(), "voltonaut-pwa-")), "dist");
  const nodeEnv = process.env["NODE_ENV"];

  // Vitest runs with NODE_ENV=test, which would build without the production-only
  // service worker registration.
  process.env["NODE_ENV"] = "production";

  try {
    await build({ root: resolve(import.meta.dirname, "../.."), build: { outDir: dist } });
  } finally {
    process.env["NODE_ENV"] = nodeEnv ?? "test";
  }

  return dist;
}

function fetchApi(page: Page, url: string): Promise<string> {
  return page.evaluate(
    (target) =>
      fetch(target, { headers: { Authorization: "Bearer secret-session-token" } }).then(
        (response) => response.text(),
        () => "network error",
      ),
    url,
  );
}

function cacheContents(page: Page): Promise<{ names: string[]; urls: string[] }> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const opened = await Promise.all(names.map((name) => caches.open(name)));
    const requests = await Promise.all(opened.map((cache) => cache.keys()));

    return { names, urls: requests.flat().map((request) => request.url) };
  });
}

function startApi(requests: string[]): Promise<Listening> {
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

interface Fixture {
  readonly dist: string;
  readonly browser: Browser;
  readonly app: Listening;
  readonly api: Listening;
  readonly page: Page;
  readonly apiRequests: string[];
}

async function startFixture(): Promise<Fixture> {
  const dist = await buildProduction();
  const apiRequests: string[] = [];
  const api = await startApi(apiRequests);
  const app = await listen(serveDist(dist));
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  return { dist, browser, app, api, page, apiRequests };
}

async function verifyManifest(dist: string): Promise<void> {
  const manifest = await readFile(join(dist, "manifest.webmanifest"), "utf8");
  const icons = [...manifest.matchAll(/"src":\s*"([^"]+)"/gu)].map((match) => String(match[1]));

  expect(manifest).toContain('"display": "standalone"');
  expect(manifest).toContain('"start_url": "/"');
  expect(manifest).toContain("192x192");
  expect(manifest).toContain("512x512");
  expect(manifest).toContain('"purpose": "maskable"');
  expect(icons).toHaveLength(3);
  await Promise.all(icons.map((icon) => stat(join(dist, icon))));
}

async function verifyCache({ app, api, page }: Fixture): Promise<void> {
  await page.goto(`${app.origin}/?sim=1`);
  await page.evaluate(() => navigator.serviceWorker.ready.then((ready) => ready.scope));
  // The first load is not controlled yet; a reload hands the page to the worker.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  expect(await fetchApi(page, `${api.origin}/v1/session`)).toContain("secret-session-token");

  const cached = await cacheContents(page);

  expect(cached.names).toHaveLength(1);
  expect(cached.names[0]).toMatch(/^voltonaut-shell-[0-9a-f]{12}$/u);
  expect(cached.urls.length).toBeGreaterThan(5);
  expect(cached.urls.every((url) => url.startsWith(`${app.origin}/`))).toBe(true);
  expect(cached.urls.some((url) => /session|auth|rides|checkpoint/u.test(url))).toBe(false);
}

async function verifyOffline({ app, api, page, apiRequests }: Fixture): Promise<void> {
  await stop(app);
  await page.reload();

  expect(await page.locator("#game-menu-open").isVisible()).toBe(true);
  expect(await page.locator("#hud-status").isVisible()).toBe(true);

  const before = apiRequests.length;

  expect(await fetchApi(page, `${api.origin}/v1/session`)).toContain("secret-session-token");
  expect(apiRequests).toHaveLength(before + 1);
}

describe("built PWA", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await startFixture();
  }, 120_000);

  afterAll(async () => {
    await fixture.browser.close();
    await stop(fixture.api);
    await stop(fixture.app);
  });

  it("ships an installable manifest with existing icons", async () => {
    await expect(verifyManifest(fixture.dist)).resolves.toBeUndefined();
  });

  it("registers the worker and caches only own-origin files", async () => {
    await expect(verifyCache(fixture)).resolves.toBeUndefined();
  });

  it("reloads the app shell offline and still passes API traffic to the network", async () => {
    await expect(verifyOffline(fixture)).resolves.toBeUndefined();
  });
});
