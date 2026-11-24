import { expect, test, type ConsoleMessage } from "@playwright/test";

function consoleErrors(
  message: Readonly<Pick<ConsoleMessage, "type" | "text">>,
): readonly string[] {
  return message.type() === "error" ? [message.text()] : [];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and test fixtures.
test("renders seeded rain while the ride and keyboard stay live", async ({ page }, testInfo) => {
  const errors: string[] = [];

  page.on("pageerror", (error: Readonly<Error>) => {
    errors.push(error.message);
  });
  page.on("console", (message: Readonly<Pick<ConsoleMessage, "type" | "text">>) => {
    errors.push(...consoleErrors(message));
  });

  await page.goto("/?sim=1&debug=1&seed=7&time=18:30&weather=rain");
  const debug = page.getByLabel("Render diagnostics");
  const canvas = page.getByLabel("3D ride scene");

  await expect(debug).toHaveAttribute("data-weather", "rain");
  await expect
    .poll(async () => Number(await debug.getAttribute("data-rain-amount")))
    .toBeCloseTo(0.6324159054, 6);
  await expect
    .poll(async () => Number(await debug.getAttribute("data-time-of-day")))
    .toBeGreaterThanOrEqual(66_600);
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");

  const distanceBefore = Number(await debug.getAttribute("data-distance-m"));

  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect
    .poll(async () => Number(await debug.getAttribute("data-distance-m")))
    .toBeGreaterThan(distanceBefore);
  await page.screenshot({ path: testInfo.outputPath("actual-environment-rain-fixed.png") });
  expect(errors).toEqual([]);
});
