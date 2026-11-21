import { expect, test } from "@playwright/test";
import { openGameMenu } from "./helpers/gameMenu.js";
import { bluetoothFakeScript } from "./helpers/bluetooth.js";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("ride menu exposes existing profile, recordings and account without body scroll", async ({
  page,
}) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.getByRole("button", { name: "Menü", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Geräte verbinden", exact: true }),
  ).toBeInViewport();
  await openGameMenu(page, "Profil");
  await expect(page.getByTestId("profile-massKg")).toBeVisible();
  await openGameMenu(page, "Aufnahmen");
  await expect(page.getByRole("button", { name: "Aufnahme starten", exact: true })).toBeVisible();
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
  await openGameMenu(page, "Strava");
  await expect(page.getByRole("tabpanel", { name: "Strava" })).toContainText(
    "Für Strava ausdrücklich bei Voltonaut anmelden",
  );
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("native menu traps focus, supports named keyboard tabs and restores focus on Escape", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  const open = page.getByRole("button", { name: "Menü", exact: true });
  const menu = page.getByRole("dialog", { name: "Fahrtmenü" });
  await open.click();
  const close = menu.getByRole("button", { name: "Zurück zur Fahrt", exact: true });
  const devices = menu.getByRole("button", { name: "Geräte öffnen", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(devices).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  const profile = menu.getByRole("tab", { name: "Profil", exact: true });
  await profile.focus();
  await page.keyboard.press("ArrowRight");
  await expect(menu.getByRole("tab", { name: "Aufnahmen", exact: true })).toBeFocused();
  await expect(menu.getByRole("tabpanel", { name: "Aufnahmen", exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(menu.getByRole("tab", { name: "Strava", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(profile).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(open).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await close.click();
  await expect(open).toBeFocused();
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("editing the menu never shifts or changes camera while native number editing still works", async ({
  page,
}) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const diagnostics = page.getByLabel("Render diagnostics");
  await expect(diagnostics).toHaveAttribute("data-camera", "chase");
  await openGameMenu(page, "Profil");
  const mass = page.getByTestId("profile-massKg");
  await mass.fill("75");
  await mass.press("ArrowUp");
  await expect(mass).toHaveValue("76");
  await mass.press("ArrowDown");
  await expect(mass).toHaveValue("75");
  const name = page.getByTestId("profile-displayName");
  await name.fill("Rider");
  await name.press("End");
  await name.press("c");
  await expect(name).toHaveValue("Riderc");
  await page.getByRole("tab", { name: "Profil", exact: true }).press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await expect(diagnostics).toHaveAttribute("data-camera", "chase");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await page.keyboard.press("c");
  await expect(diagnostics).toHaveAttribute("data-camera", "overview");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and test fixtures.
test("menu keeps world and HUD moving", async ({ page }, testInfo) => {
  await page.goto("/?sim=1&debug=1");
  const diagnostics = page.getByLabel("Render diagnostics");
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-calls")))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("desktop-ride.png") });
  await openGameMenu(page, "Profil");
  const distanceM = Number(await diagnostics.getAttribute("data-distance-m"));
  const hudDistance = await page.getByTestId("hud-distance").textContent();
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
    .toBeGreaterThan(distanceM + 8);
  await expect(page.getByTestId("hud-distance")).not.toHaveText(String(hudDistance));
  const calls = Number(await diagnostics.getAttribute("data-calls"));
  const triangles = Number(await diagnostics.getAttribute("data-triangles"));
  expect(calls).toBeLessThanOrEqual(150);
  expect(triangles).toBeLessThanOrEqual(500_000);
  await testInfo.attach("menu-render-budget.json", {
    body: JSON.stringify({
      calls,
      triangles,
      distanceM,
      movedDistanceM: Number(await diagnostics.getAttribute("data-distance-m")),
    }),
    contentType: "application/json",
  });
  await expect(page.locator("#ride-scene")).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".hud")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("desktop-menu.png") });
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and test fixtures.
test("small menu scrolls internally", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Profil");
  await expect(page.locator("#ride-scene")).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".hud")).toBeInViewport({ ratio: 1 });
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
  await page.screenshot({ path: testInfo.outputPath("small-menu.png") });
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-status")).toHaveText("Saved locally");
  await page.screenshot({ path: testInfo.outputPath("small-menu-scrolled.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Geräte verbinden", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: testInfo.outputPath("small-ride.png") });
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("unsupported browser guidance stays on the game screen without body scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await expect(
    page.getByText("Web Bluetooth benötigt Chrome/Edge", { exact: false }),
  ).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".hud")).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await openGameMenu(page, "Profil");
  await expect(
    page.getByRole("button", { name: "Bluetooth nicht verfügbar", exact: true }),
  ).toBeDisabled();
  await page.getByTestId("profile-massKg").press("Escape");
  await expect(page.getByRole("dialog", { name: "Fahrtmenü" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Menü", exact: true })).toBeFocused();
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("menu devices action opens only the existing dialog and never selects a device", async ({
  page,
}) => {
  await page.addInitScript({ content: bluetoothFakeScript() });
  await page.goto("/");
  await openGameMenu(page, "Profil");
  await page.getByRole("button", { name: "Geräte öffnen", exact: true }).click();
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });
  await expect(devices).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Fahrtmenü" })).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-trainer-selections");
  await page.keyboard.press("Escape");
  await expect(devices).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "Fahrtmenü" })).not.toBeVisible();
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  await expect(devices).toBeVisible();

  const trainer = devices
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Trainer", exact: true }) });

  await trainer.getByRole("button", { name: "Gerät wählen", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-trainer-selections", "1");
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("error");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("closing the menu leaves an active recording running and available to finish", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await page.getByRole("button", { name: "Zurück zur Fahrt", exact: true }).click();
  await page.waitForTimeout(1200);
  await openGameMenu(page, "Aufnahmen");
  await expect(page.getByTestId("recording-status")).toContainText("Aufnahme läuft");
  await expect(page.getByRole("button", { name: "Aufnahme starten", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toBeVisible();
});
