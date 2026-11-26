import { expect, test, type Locator } from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";
import { assertFooterBoundary } from "./helpers/menuLayoutAssertions.js";
import { readLayout, scrollContent } from "./helpers/menuLayout.js";

async function verticalBounds(
  target: Readonly<Locator>,
): Promise<{ readonly top: number; readonly bottom: number }> {
  const box = await target.boundingBox();

  if (box === null) throw new Error("Missing layout box");

  return { top: box.y, bottom: box.y + box.height };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("tab changes reset the shared content scroll to the top", async ({ page }) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "App");
  await scrollContent(page, "bottom");
  await expect
    .poll(() =>
      page
        .locator(".game-menu__content")
        .evaluate((element: Readonly<Pick<HTMLElement, "scrollTop">>) => element.scrollTop),
    )
    .toBeGreaterThan(0);

  await openGameMenu(page, "Profil");
  await expect
    .poll(() =>
      page
        .locator(".game-menu__content")
        .evaluate((element: Readonly<Pick<HTMLElement, "scrollTop">>) => element.scrollTop),
    )
    .toBe(0);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("menu keeps its footer inside the dialog and the last profile field reachable at 320x900", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Profil");

  const menu = page.getByRole("dialog", { name: "Fahrtmenü", exact: true });
  const footer = menu.locator(".game-menu__footer");
  const menuBox = await verticalBounds(menu);
  const footerBox = await verticalBounds(footer);

  expect(footerBox.bottom).toBeLessThanOrEqual(menuBox.bottom + 1);
  assertFooterBoundary(await readLayout(page), "320x900 top");

  await scrollContent(page, "bottom");
  assertFooterBoundary(await readLayout(page), "320x900 bottom");
  await expect(page.getByTestId("profile-wheelCircM")).toBeInViewport({ ratio: 1 });
});
