import { expect, test } from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";
import { scrollContent } from "./helpers/menuLayout.js";

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
