import { expect, test } from "@playwright/test";

interface TextContentSource {
  readonly textContent: () => Promise<string | null>;
}

async function numericDistance(element: TextContentSource): Promise<number> {
  const text = await element.textContent();

  return Number(text?.replaceAll(/[^0-9]/gu, "") ?? "0");
}

// Best effort per spec E3-01 AK9: the engine runs in a dedicated worker, so a
// backgrounded tab keeps accumulating distance. Chrome's page freezing (>5 min
// hidden, active BLE) is Henry's manual check (docs/specs E3-01 section 5.8).
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's fixture object is an external mutable type; it cannot be narrowed from our side.
test("distance keeps growing while the tab is in the background", async ({ browser, page }) => {
  await page.goto("/?sim=1&clock=fast");

  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect.poll(() => numericDistance(page.getByTestId("hud-distance"))).toBeGreaterThan(0);

  const distanceBefore = await numericDistance(page.getByTestId("hud-distance"));

  const otherTab = await browser.newPage();
  await otherTab.bringToFront();

  await page.waitForTimeout(2000);

  const distanceAfter = await numericDistance(page.getByTestId("hud-distance"));

  expect(distanceAfter).toBeGreaterThan(distanceBefore);

  await otherTab.close();
});
