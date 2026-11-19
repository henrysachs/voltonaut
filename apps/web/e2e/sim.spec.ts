import { expect, test, type Locator } from "@playwright/test";

async function numericValue(element: Locator): Promise<number> {
  const text = await element.textContent();

  return Number(text?.replaceAll(/[^0-9]/gu, "") ?? "0");
}

test("sim mode shows changing values and shifts with the arrow keys", async ({ page }) => {
  await page.goto("/?sim=1");

  const status = page.getByTestId("hud-status");
  const power = page.getByTestId("hud-power");
  const cadence = page.getByTestId("hud-cadence");
  const heartRate = page.getByTestId("hud-heart-rate");
  const gear = page.getByTestId("hud-gear");

  await expect(status).toHaveText("Sim connected");
  await expect.poll(() => numericValue(power)).toBeGreaterThan(0);
  await expect.poll(() => numericValue(cadence)).toBeGreaterThan(0);
  await expect.poll(() => numericValue(heartRate)).toBeGreaterThan(0);

  await expect(gear).toHaveText("1");
  await page.keyboard.press("ArrowUp");
  await expect(gear).toHaveText("2");
  await page.keyboard.press("ArrowDown");
  await expect(gear).toHaveText("1");
});
