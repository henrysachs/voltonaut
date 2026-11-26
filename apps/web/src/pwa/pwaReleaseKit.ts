import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect } from "vitest";

import { listen, serveDist, stop } from "./pwaTestKit.js";
import type { Listening } from "./pwaTestKit.js";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright handles and the release map are mutable by contract.
interface ReleasedFile {
  readonly type: string;
  readonly body: string;
}

/** One installed release on its own origin; its page is controlled by the release's worker. */
export interface InstalledShell {
  readonly dist: string;
  readonly app: Listening;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Files of the next release by path; the server answers them instead of the build. */
  readonly next: Map<string, ReleasedFile>;
}

const INSTALL_PATH = "/__install";
const UPDATE_MARKER = '<meta name="update-marker" content="next">';

const WARNING =
  "Eine neue Version ist bereit. Aktualisieren lädt die Seite neu und verwirft eine laufende Aufnahme.";

/**
 * Serves the shared build on a fresh origin and installs its worker. A blank page registers
 * the worker, so the app boots once and already controlled; the app's own registration of
 * the same script is covered by "registers the worker" in pwa.build.test.ts.
 */
async function installShell(browser: Browser, dist: string): Promise<InstalledShell> {
  const next = new Map<string, ReleasedFile>();
  const serve = serveDist(dist);

  const app = await listen((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const released = next.get(pathname);

    if (pathname === INSTALL_PATH) {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>install</title>");
    } else if (released === undefined) {
      serve(request, response);
    } else {
      response.writeHead(200, { "Content-Type": released.type, "Cache-Control": "no-cache" });
      response.end(released.body);
    }
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${app.origin}${INSTALL_PATH}`);
  await page.evaluate(() =>
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((ready) => ready.scope),
  );
  await page.goto(`${app.origin}/?sim=1`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  return { dist, app, context, page, next };
}

async function removeShell(shell: InstalledShell): Promise<void> {
  await shell.context.close();
  await stop(shell.app);
}

/** One independent shell per update step; the later steps start with the release announced. */
export interface ReleaseShells {
  readonly fresh: InstalledShell;
  readonly forNotice: InstalledShell;
  readonly forApply: InstalledShell;
}

export async function installReleaseShells(browser: Browser, dist: string): Promise<ReleaseShells> {
  const fresh = await installShell(browser, dist);
  const forNotice = await installShell(browser, dist);
  const forApply = await installShell(browser, dist);

  await announceRelease(forNotice);
  await announceRelease(forApply);

  return { fresh, forNotice, forApply };
}

export async function removeReleaseShells(shells: ReleaseShells): Promise<void> {
  await removeShell(shells.fresh);
  await removeShell(shells.forNotice);
  await removeShell(shells.forApply);
}

/** A new release: changed shell bytes and a changed worker script, as a real deploy produces. */
async function publishRelease({ dist, next }: InstalledShell): Promise<void> {
  const index = await readFile(join(dist, "index.html"), "utf8");
  const worker = await readFile(join(dist, "sw.js"), "utf8");
  const shell = { type: "text/html", body: index.replace("</head>", `${UPDATE_MARKER}</head>`) };

  next.set("/", shell);
  next.set("/index.html", shell);
  next.set("/sw.js", { type: "text/javascript", body: `${worker}\n// next release\n` });
}

function updateShortcut(page: Page): Locator {
  return page.getByRole("button", { name: "Neue Version", exact: true });
}

function applyButton(page: Page): Locator {
  return page.getByRole("button", { name: "Jetzt aktualisieren", exact: true });
}

function updateMarkers(page: Page): Promise<number> {
  return page.locator('meta[name="update-marker"]').count();
}

function menuVisible(page: Page): Promise<boolean> {
  return page.getByRole("dialog", { name: "Fahrtmenü" }).isVisible();
}

/** Asks the browser for an update check, like a returning tab, and waits for the shortcut. */
async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(() =>
    navigator.serviceWorker.getRegistration().then((registration) => registration?.update()),
  );
  await updateShortcut(page).waitFor({ state: "visible" });
}

/** Setup for the steps after the announcement: a published release the page has found. */
async function announceRelease(shell: InstalledShell): Promise<void> {
  await publishRelease(shell);
  await checkForUpdate(shell.page);
}

/**
 * A real pointer click that skips only Playwright's frame-stability wait: without rendered
 * frames under load that wait alone took 1.5–2.5 s (docs/specs/E0-16-flaky-tests.md).
 * The click still lands on whatever element is on top at the target's position.
 */
function pointerClick(target: Locator): Promise<void> {
  return target.click({ force: true });
}

export async function verifyAnnouncement(shell: InstalledShell): Promise<void> {
  const { page } = shell;

  expect(await updateShortcut(page).isVisible()).toBe(false);

  await publishRelease(shell);
  await page.reload();
  // Chromium defers its own update check after a navigation; ask for it like a returning tab would.
  await checkForUpdate(page);
  expect(await updateMarkers(page)).toBe(0);
}

export async function verifyNotice({ page }: InstalledShell): Promise<void> {
  const shortcut = updateShortcut(page);

  await pointerClick(shortcut);

  expect(await menuVisible(page)).toBe(true);
  expect(await shortcut.getAttribute("aria-haspopup")).toBe("dialog");
  expect(
    await page
      .getByRole("group", { name: WARNING })
      .evaluate((element) => element === document.activeElement),
  ).toBe(true);
  expect(await page.getByText(WARNING, { exact: true }).isVisible()).toBe(true);
  // The reload button carries the recording warning as its accessible description.
  expect(
    await applyButton(page).evaluate((element) => {
      const id = element.getAttribute("aria-describedby") ?? "";

      return document.querySelector(`#${id}`)?.textContent ?? "";
    }),
  ).toBe(WARNING);

  // A repeated Enter after the shortcut lands on the notice, not on the reload button.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(await updateMarkers(page)).toBe(0);
  expect(await menuVisible(page)).toBe(true);
}

export async function verifyApply({ page }: InstalledShell): Promise<void> {
  await pointerClick(updateShortcut(page));
  await applyButton(page).waitFor({ state: "visible" });
  await Promise.all([page.waitForEvent("load"), pointerClick(applyButton(page))]);
  expect(await updateMarkers(page)).toBe(1);
}
