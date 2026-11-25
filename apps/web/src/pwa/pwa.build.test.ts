import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildProduction,
  cacheContents,
  fetchApi,
  listen,
  serveDist,
  startApi,
  stop,
} from "./pwaTestKit.js";
import type { Listening } from "./pwaTestKit.js";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright handles are mutable by contract.
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

const MARKER = '<meta name="release-marker" content="fresh">';

function markerCount(page: Page): Promise<number> {
  return page.locator('meta[name="release-marker"]').count();
}

async function openAppTab(page: Page): Promise<void> {
  await page.locator("#game-menu-open").click();
  await page.getByRole("tab", { name: "App", exact: true }).click();
}

function seedBrowserData(page: Page): Promise<void> {
  return page.evaluate(async () => {
    window.localStorage.setItem("voltonaut-test-profile", "keep");
    await caches.open("other-app-cache");

    await new Promise<void>((done, fail) => {
      const open = indexedDB.open("voltonaut-test-recordings", 1);
      open.addEventListener("upgradeneeded", () => {
        open.result.createObjectStore("rides");
      });
      open.addEventListener("success", () => {
        const write = open.result.transaction("rides", "readwrite");
        write.objectStore("rides").put("recorded ride", "ride-1");
        write.addEventListener("complete", () => {
          done();
        });
      });
      open.addEventListener("error", () => {
        fail(new Error("indexedDB failed"));
      });
    });
  });
}

function readBrowserData(page: Page) {
  return page.evaluate(async () => {
    const ride = await new Promise<string>((done) => {
      const open = indexedDB.open("voltonaut-test-recordings", 1);
      open.addEventListener("success", () => {
        const read = open.result.transaction("rides").objectStore("rides").get("ride-1");
        read.addEventListener("success", () => {
          done(String(read.result));
        });
      });
    });

    return {
      profile: window.localStorage.getItem("voltonaut-test-profile"),
      ride,
      caches: await caches.keys(),
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
    };
  });
}

async function verifyHardReload({ dist, app, page }: Fixture): Promise<void> {
  await seedBrowserData(page);
  // The controlled page keeps serving the old cached shell, even after a new release.
  const index = join(dist, "index.html");

  await writeFile(index, (await readFile(index, "utf8")).replace("</head>", `${MARKER}</head>`));
  await page.reload();
  expect(await markerCount(page)).toBe(0);

  const before = await readBrowserData(page);

  await openAppTab(page);
  await page.getByRole("button", { name: "Hard Reload", exact: true }).click();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();

  expect(await readBrowserData(page)).toEqual(before);
  expect(await markerCount(page)).toBe(0);

  await page.getByRole("button", { name: "Hard Reload", exact: true }).click();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Ja, jetzt neu laden", exact: true }).click(),
  ]);

  expect(await markerCount(page)).toBe(1);
  await page.evaluate(() => navigator.serviceWorker.ready.then((ready) => ready.scope));

  const after = await readBrowserData(page);

  expect(after.profile).toBe("keep");
  expect(after.ride).toBe("recorded ride");
  expect(after.caches).toContain("other-app-cache");
  expect(after.caches.filter((name) => name.startsWith("voltonaut-shell-"))).toHaveLength(1);
  expect(after.registrations).toBe(1);
  expect(page.url()).toBe(`${app.origin}/?sim=1`);
}

const UPDATE_MARKER = '<meta name="update-marker" content="next">';

/** A new release: changed shell bytes and a changed worker script, as a real deploy produces. */
async function publishRelease(dist: string): Promise<void> {
  const index = join(dist, "index.html");
  const worker = join(dist, "sw.js");

  await writeFile(
    index,
    (await readFile(index, "utf8")).replace("</head>", `${UPDATE_MARKER}</head>`),
  );
  await writeFile(worker, `${await readFile(worker, "utf8")}\n// next release\n`);
}

async function verifyUpdateShortcut({ dist, page }: Fixture): Promise<void> {
  const shortcut = page.getByRole("button", { name: "Neue Version", exact: true });

  expect(await shortcut.isVisible()).toBe(false);

  await publishRelease(dist);
  await page.reload();
  // Chromium defers its own update check after a navigation; ask for it like a returning tab would.
  await page.evaluate(() =>
    navigator.serviceWorker.getRegistration().then((registration) => registration?.update()),
  );
  await shortcut.waitFor({ state: "visible" });
  expect(await page.locator('meta[name="update-marker"]').count()).toBe(0);

  await shortcut.click();

  const apply = page.getByRole("button", { name: "Jetzt aktualisieren", exact: true });

  const warning =
    "Eine neue Version ist bereit. Aktualisieren lädt die Seite neu und verwirft eine laufende Aufnahme.";

  expect(await page.getByRole("dialog", { name: "Fahrtmenü" }).isVisible()).toBe(true);
  expect(await shortcut.getAttribute("aria-haspopup")).toBe("dialog");
  expect(
    await page
      .getByRole("group", { name: warning })
      .evaluate((element) => element === document.activeElement),
  ).toBe(true);
  expect(await page.getByText(warning, { exact: true }).isVisible()).toBe(true);
  // The reload button carries the recording warning as its accessible description.
  expect(
    await apply.evaluate((element) => {
      const id = element.getAttribute("aria-describedby") ?? "";

      return document.querySelector(`#${id}`)?.textContent ?? "";
    }),
  ).toBe(warning);

  // A repeated Enter after the shortcut lands on the notice, not on the reload button.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(await page.locator('meta[name="update-marker"]').count()).toBe(0);
  expect(await page.getByRole("dialog", { name: "Fahrtmenü" }).isVisible()).toBe(true);

  await Promise.all([page.waitForEvent("load"), apply.click()]);
  expect(await page.locator('meta[name="update-marker"]').count()).toBe(1);
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

  it("hard reload bypasses the old cache and keeps stored browser data", async () => {
    await expect(verifyHardReload(fixture)).resolves.toBeUndefined();
  });

  it("announces a waiting release next to the menu and applies it on request", async () => {
    await expect(verifyUpdateShortcut(fixture)).resolves.toBeUndefined();
  });

  it("reloads the app shell offline and still passes API traffic to the network", async () => {
    await expect(verifyOffline(fixture)).resolves.toBeUndefined();
  });
});
