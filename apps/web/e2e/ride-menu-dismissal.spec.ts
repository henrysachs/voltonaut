import { expect, test } from "@playwright/test";
import { openGameMenu } from "./helpers/gameMenu.js";
import { drawnDistanceM } from "./helpers/rideWorld.js";

const outside = { x: 30, y: 450 };

test.describe("touch dismissal", () => {
  test.use({ hasTouch: true, viewport: { width: 800, height: 900 } });

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
  test("outside taps close ride and device dialogs while inside taps keep them open", async ({
    page,
  }) => {
    await page.goto("/?sim=1");
    const menu = page.getByRole("dialog", { name: "Fahrtmenü" });
    await page.getByRole("button", { name: "Menü", exact: true }).tap();
    await menu.getByRole("heading", { name: "Fahrtmenü", exact: true }).tap();
    await expect(menu).toBeVisible();
    await page.touchscreen.tap(outside.x, outside.y);
    await expect(menu).not.toBeVisible();

    const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });
    await page.getByRole("button", { name: "Geräte verbinden", exact: true }).tap();
    await devices.getByRole("heading", { name: "Trainer", exact: true }).tap();
    await expect(devices).toBeVisible();
    await page.touchscreen.tap(outside.x, outside.y);
    await expect(devices).not.toBeVisible();
    await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  });
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("ride menu keeps inside clicks open and dismisses on an outside click with focus restored", async ({
  page,
}) => {
  await page.goto("/?sim=1&debug=1");
  const open = page.getByRole("button", { name: "Menü", exact: true });
  const menu = page.getByRole("dialog", { name: "Fahrtmenü" });
  await open.click();
  await menu.getByRole("heading", { name: "Fahrtmenü", exact: true }).click();
  await expect(menu).toBeVisible();
  await page.mouse.click(outside.x, outside.y);
  await expect(menu).not.toBeVisible();
  await expect(open).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("outside dismissal keeps the ordinary ride and an active recording running", async ({
  page,
}) => {
  await page.goto("/?sim=1&debug=1");
  const diagnostics = page.getByLabel("Render diagnostics");
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  const distanceM = await drawnDistanceM(page);
  await page.mouse.click(outside.x, outside.y);
  await expect(page.getByRole("dialog", { name: "Fahrtmenü" })).not.toBeVisible();
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
    .toBeGreaterThan(distanceM + 2);
  await openGameMenu(page, "Aufnahmen");
  await expect(page.getByTestId("recording-status")).toContainText("Aufnahme läuft");
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("device dialog dismisses outside, stays open inside and leaves Sim connections active", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const open = page.getByRole("button", { name: "Geräte verbinden", exact: true });
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });
  await open.click();
  await devices.getByRole("heading", { name: "Trainer", exact: true }).click();
  await expect(devices).toBeVisible();
  await page.mouse.click(outside.x, outside.y);
  await expect(devices).not.toBeVisible();
  await expect(open).toBeFocused();
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.getByTestId("hud-power")).not.toHaveText("0 W");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("device cards lead with plain status and actions while diagnostics remain available", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });
  await expect(devices.getByText("Verbunden", { exact: true }).first()).toBeVisible();

  const trainer = devices
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Trainer", exact: true }) });

  await expect(
    trainer.getByRole("button", { name: "Widerstand aktivieren", exact: true }),
  ).toBeVisible();
  await expect(trainer.getByLabel("Trainer-ACK")).not.toBeVisible();
  await trainer.getByText("Technische Details", { exact: true }).click();
  await expect(trainer.getByLabel("Trainer-ACK")).toBeVisible();
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("ready");
  await expect(trainer.getByLabel("Trainer-ACK")).toContainText("Widerstand unbekannt");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("outside dismissal does not disable an explicitly active Sim trainer control", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });
  await devices.getByRole("button", { name: "Widerstand aktivieren", exact: true }).click();
  await expect(
    devices.getByRole("group", { name: "Rollenschaltung", exact: true }),
  ).toHaveAttribute("data-authority", "active");
  await page.mouse.click(outside.x, outside.y);
  await expect(devices).not.toBeVisible();
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  await expect(
    devices.getByRole("group", { name: "Rollenschaltung", exact: true }),
  ).toHaveAttribute("data-authority", "active");
  await expect(page.getByTestId("hud-resistance")).toHaveAttribute("data-state", "active");
  await devices.getByRole("button", { name: "Widerstand deaktivieren", exact: true }).click();
  await expect(page.getByTestId("hud-resistance")).toHaveText(
    "Widerstand aus · Stop bestätigt · neu verbinden",
  );
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("small device dialog keeps primary controls in view and supports keyboard details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?sim=1");
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });
  await expect(devices.getByRole("button", { name: "Schließen", exact: true })).toBeInViewport({
    ratio: 1,
  });

  const trainer = devices
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Trainer", exact: true }) });

  const details = trainer.getByText("Technische Details", { exact: true });

  await details.focus();
  await page.keyboard.press("Enter");
  await expect(trainer.getByLabel("Trainer-ACK")).toBeVisible();

  const height = await trainer
    .getByRole("button", { name: "Widerstand aktivieren", exact: true })
    .evaluate(
      (element: Readonly<Pick<HTMLElement, "getBoundingClientRect">>) =>
        element.getBoundingClientRect().height,
    );

  expect(height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
