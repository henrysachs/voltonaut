/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser page and test fixtures. */
import {
  expect,
  test,
  type Locator,
  type Page,
  type Request as PlaywrightRequest,
  type TestInfo,
} from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";
import { previewWorkerPrelude } from "./render-worker.helpers.js";

interface PageFixture {
  readonly page: Readonly<Page>;
}

function watchPurchaseRequests(page: Readonly<Page>): string[] {
  const urls: string[] = [];
  page.on("request", (request: Readonly<PlaywrightRequest>) => {
    if (/\/(?:v1\/)?shop(?:\/|$)|\/purchase(?:\/|$)/u.test(request.url())) {
      urls.push(request.url());
    }
  });

  return urls;
}

async function expectMinimumHitArea(target: Readonly<Locator>): Promise<void> {
  const box = await target.boundingBox();

  if (box === null) throw new Error("Missing hit area");

  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test("garage previews items and colors, keeps guest purchases disabled and the ride continues", async ({
  page,
}: Readonly<PageFixture>, testInfo: Readonly<TestInfo>) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");

  const panel = page.getByRole("tabpanel", { name: "Garage / Shop", exact: true });
  const preview = page.getByTestId("garage-preview");
  await expect(preview).toHaveAttribute("data-preview-state", "preview");
  await expect(preview.locator("canvas")).toHaveAttribute("data-preview-ready", "true");
  await expect(page.getByTestId("garage-item-name")).toHaveText("Voltonaut Classic");
  await expect(page.getByTestId("garage-purchase")).toBeDisabled();
  await expect(page.getByTestId("garage-purchase")).toHaveText("Nicht käuflich");

  await page.getByTestId("garage-item-jersey.stripe").click();
  await expect(page.getByTestId("garage-item-name")).toHaveText("Blitzstreifen");
  await expect(page.getByTestId("garage-price")).toHaveText("1.500 ⚡");
  await expect(panel).toContainText("Common · Shop");
  await expect(page.getByTestId("garage-purchase")).toBeDisabled();
  await expect(page.getByTestId("garage-purchase")).toHaveText("Kauf nicht verfügbar");
  await expect(page.getByTestId("garage-purchase-hint")).toHaveText(
    "Zum Kaufen anmelden. Bis dahin nur Vorschau.",
  );
  await expect(panel).not.toContainText("Guthaben");

  const firstColor = page.getByRole("radio", { name: "Farbe 1: #45c4b0", exact: true });
  await firstColor.check();
  await expect(firstColor).toBeChecked();

  await page.getByTestId("garage-slot-frame").click();
  await page.getByTestId("garage-item-frame.aero").click();
  await expect(page.getByTestId("garage-item-name")).toHaveText("Aero");
  await expect(page.getByTestId("garage-price")).toHaveText("6.000 ⚡");
  await expect(panel).toContainText("Shop · ab Level 5 (Prüfung folgt)");

  const diagnostics = page.getByLabel("Render diagnostics");
  const distanceM = Number(await diagnostics.getAttribute("data-distance-m"));
  expect(Number.isFinite(distanceM)).toBe(true);
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
    .toBeGreaterThan(distanceM + 2);
  await page.screenshot({ path: testInfo.outputPath("garage-shop.png") });

  await page.mouse.click(8, 8);
  await expect(page.getByRole("dialog", { name: "Fahrtmenü" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Menü", exact: true })).toBeFocused();
});

test("skin selection uses direct colors instead of named items", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
  await page.getByTestId("garage-slot-skin").click();

  await expect(page.getByTestId("garage-item-name")).toHaveText("Hautfarbe");
  await expect(page.locator(".garage__browse")).toBeHidden();

  const darkSkin = page.getByRole("radio", { name: "Farbe 1: #654638", exact: true });
  await darkSkin.check();
  await expect(darkSkin).toBeChecked();
});

test("garage preview is not persisted and a guest sends no purchase request", async ({
  page,
}: Readonly<PageFixture>) => {
  const purchaseRequests = watchPurchaseRequests(page);
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
  await page.getByTestId("garage-item-jersey.stripe").click();
  await expect(page.getByTestId("garage-item-name")).toHaveText("Blitzstreifen");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
  await expect(page.getByTestId("garage-item-name")).toHaveText("Voltonaut Classic");
  expect(purchaseRequests).toEqual([]);
});

test("garage keeps item information usable without WebGL and honors reduced motion", async ({
  page,
}: Readonly<PageFixture>, testInfo: Readonly<TestInfo>) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await previewWorkerPrelude(page, "OffscreenCanvas.prototype.getContext = () => null;");
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");

  await expect(page.getByTestId("garage-preview")).toHaveAttribute(
    "data-preview-state",
    "unavailable3d",
  );
  await expect(page.getByRole("tabpanel", { name: "Garage / Shop", exact: true })).toContainText(
    "3D nicht verfügbar",
  );
  await expect(page.getByRole("button", { name: "Links drehen", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Drehung starten", exact: true })).toBeDisabled();

  await page.getByTestId("garage-item-jersey.stripe").click();
  await expect(page.getByTestId("garage-item-name")).toHaveText("Blitzstreifen");
  await expect(page.getByTestId("garage-price")).toHaveText("1.500 ⚡");
  await expect(page.getByTestId("garage-purchase")).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("garage-shop-no-webgl.png") });
});

test("garage stays inside the small ride menu without body scrolling", async ({
  page,
}: Readonly<PageFixture>, testInfo: Readonly<TestInfo>) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
  await page.getByTestId("garage-slot-wheels").click();
  await page.getByTestId("garage-item-wheels.carbon-deep").click();
  await expect(page.getByTestId("garage-item-name")).toHaveText("Carbon tief");
  await expect(page.getByTestId("garage-price")).toHaveText("20.000 ⚡");

  await page.getByTestId("garage-slot-frame").click();
  const colorTarget = page.locator(".garage__color").first();

  const targets = [
    page.getByTestId("garage-slot-frame"),
    page.getByRole("button", { name: "Links drehen", exact: true }),
    colorTarget,
  ];

  await Promise.all(targets.map((target) => expectMinimumHitArea(target)));

  const swatch = await colorTarget.locator("span").boundingBox();
  expect(swatch?.width).toBe(28);
  expect(swatch?.height).toBe(28);

  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page
      .locator(".game-menu__content")
      .evaluate(
        (element: Readonly<Pick<Element, "scrollHeight" | "clientHeight">>) =>
          element.scrollHeight > element.clientHeight,
      ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("garage-shop-small.png") });
});

/* oxlint-enable typescript/prefer-readonly-parameter-types */
