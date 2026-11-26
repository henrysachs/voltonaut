/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright fixtures and browser evaluate callbacks retain native mutable DOM types. */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";

interface PageFixture {
  readonly page: Readonly<Page>;
}

interface ButtonTreatment {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly color: string;
}

interface DeviceBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly dialogWidth: number;
  readonly dialogScrollWidth: number;
  readonly bodyClientHeight: number;
  readonly bodyScrollHeight: number;
  readonly bodyClientWidth: number;
  readonly bodyScrollWidth: number;
  readonly overflowY: string;
}

async function settleOverlay(target: Readonly<Locator>): Promise<void> {
  await target.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
}

function readButtonTreatment(target: Readonly<Locator>): Promise<ButtonTreatment> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
    };
  });
}

function readDeviceBounds(target: Readonly<Locator>): Promise<DeviceBounds> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const body = element.querySelector<HTMLElement>(".connect-dialog__body");

    if (body === null) throw new Error("Missing device dialog body");

    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      dialogWidth: element.clientWidth,
      dialogScrollWidth: element.scrollWidth,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      overflowY: getComputedStyle(body).overflowY,
    };
  });
}

test.use({ reducedMotion: "no-preference" });

test("menu glass gains a solid backdrop-filter fallback for reduced transparency", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Profil");

  const menu = page.getByRole("dialog", { name: "Fahrtmenü", exact: true });

  const defaultBackdrop = await menu.evaluate(
    (element) => getComputedStyle(element).backdropFilter,
  );

  expect(defaultBackdrop).not.toBe("none");
  expect(defaultBackdrop).toContain("blur");

  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  await expect(menu).toHaveCSS("backdrop-filter", "none");
  await expect(menu).toHaveCSS("background-color", "rgb(16, 42, 39)");
});

test("device dialog shows the same glass and the same solid fallback as the menu", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();

  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });

  await settleOverlay(devices);

  const glass = await devices.evaluate((element) => {
    const style = getComputedStyle(element);

    return { backdrop: style.backdropFilter, background: style.backgroundColor };
  });

  // A blur over WebGL only earns its GPU cost when the glass background actually shows.
  expect(glass.backdrop).toContain("blur");
  expect(glass.background).not.toBe("rgb(16, 42, 39)");

  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  await expect(devices).toHaveCSS("backdrop-filter", "none");
  await expect(devices).toHaveCSS("background-color", "rgb(16, 42, 39)");
});

test("visible tab panels use the short panel-in animation", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Profil");

  const profile = page.getByRole("tabpanel", { name: "Profil", exact: true });

  await expect(profile).toHaveCSS("animation-name", "game-menu-panel-in");
  await expect(profile).toHaveCSS("animation-duration", "0.2s");

  await openGameMenu(page, "Aufnahmen");
  await expect(page.getByRole("tabpanel", { name: "Aufnahmen", exact: true })).toHaveCSS(
    "animation-name",
    "game-menu-panel-in",
  );
});

test("reduced motion removes overlay transitions and panel animations", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Profil");

  const menu = page.getByRole("dialog", { name: "Fahrtmenü", exact: true });
  const profile = page.getByRole("tabpanel", { name: "Profil", exact: true });

  await expect(menu).toHaveCSS("transition-property", "none");
  await expect(menu).toHaveCSS("animation-name", "none");
  await expect(profile).toHaveCSS("transition-property", "none");
  await expect(profile).toHaveCSS("animation-name", "none");

  await menu.getByRole("button", { name: "Geräte öffnen", exact: true }).click();
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });

  await expect(devices).toBeVisible();
  await expect(devices).toHaveCSS("transition-property", "none");
  await expect(devices).toHaveCSS("animation-name", "none");
});

test("device dialog stays inside 320 px and scrolls only its body", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();

  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });
  await settleOverlay(devices);

  const bounds = await readDeviceBounds(devices);

  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(320);
  expect(bounds.bottom).toBeLessThanOrEqual(480);
  expect(bounds.dialogScrollWidth).toBeLessThanOrEqual(bounds.dialogWidth);
  expect(bounds.bodyScrollWidth).toBeLessThanOrEqual(bounds.bodyClientWidth);
  expect(bounds.overflowY).toBe("auto");
  expect(bounds.bodyScrollHeight).toBeGreaterThan(bounds.bodyClientHeight);

  const body = devices.locator(".connect-dialog__body");
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      body.evaluate((element: Readonly<Pick<HTMLElement, "scrollTop">>) => element.scrollTop),
    )
    .toBeGreaterThan(0);
});

test("garage rotation toggle keeps its selected treatment on hover", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");

  const toggle = page.getByRole("button", { name: "Drehung pausieren", exact: true });

  const selected = await readButtonTreatment(toggle);

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(selected.backgroundColor).toBe("rgb(255, 214, 10)");
  expect(selected.color).toBe("rgb(21, 41, 27)");

  await toggle.hover();
  await settleOverlay(toggle);

  expect(await readButtonTreatment(toggle)).toEqual(selected);

  const ordinary = page.getByRole("button", { name: "Links drehen", exact: true });
  await ordinary.hover();
  await settleOverlay(ordinary);
  expect(
    await ordinary.evaluate(
      (element: Readonly<HTMLElement>) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe(selected.backgroundColor);
});

/* oxlint-enable typescript/prefer-readonly-parameter-types */
