import { expect, test } from "@playwright/test";

interface TextContentSource {
  readonly textContent: () => Promise<string | null>;
}

async function numericValue(element: TextContentSource): Promise<number> {
  const text = await element.textContent();

  return Number(text?.replaceAll(/[^0-9]/gu, "") ?? "0");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's fixture object is an external mutable type; it cannot be narrowed from our side.
test("sim mode shows physics values and shifts with the arrow keys", async ({ page }) => {
  await page.goto("/?sim=1&clock=fast");

  const status = page.getByTestId("hud-status");
  const power = page.getByTestId("hud-power");
  const cadence = page.getByTestId("hud-cadence");
  const heartRate = page.getByTestId("hud-heart-rate");
  const gear = page.getByTestId("hud-gear");
  const speed = page.getByTestId("hud-speed");
  const distance = page.getByTestId("hud-distance");
  const warning = page.getByTestId("hud-warning");

  await expect(status).toHaveText("Sim connected");
  await expect(warning).toHaveText("");
  await expect.poll(() => numericValue(power)).toBeGreaterThan(0);
  await expect.poll(() => numericValue(cadence)).toBeGreaterThan(0);
  await expect.poll(() => numericValue(heartRate)).toBeGreaterThan(0);
  await expect.poll(() => numericValue(speed)).toBeGreaterThan(0);
  await expect.poll(() => numericValue(distance)).toBeGreaterThan(0);

  // Engine start gear is 12 (one-based); two ups take it to 14.
  await expect(gear).toHaveText("12");
  await page.keyboard.press("ArrowUp");
  await expect(gear).toHaveText("13");
  await page.keyboard.press("ArrowUp");
  await expect(gear).toHaveText("14");

  // The fast sim clock keeps accumulating distance from the physics.
  const distanceBefore = await numericValue(distance);
  await page.waitForTimeout(1000);
  const distanceAfter = await numericValue(distance);

  expect(distanceAfter).toBeGreaterThan(distanceBefore);
});
