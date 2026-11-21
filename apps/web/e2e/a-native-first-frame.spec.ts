import { expect, test } from "@playwright/test";
import { openGameMenu } from "./helpers/gameMenu.js";
import type { FirstDrawPoll } from "./helpers/menuFailure.js";
import { captureFirstFrameFailure, startNativeCapture } from "./helpers/nativeFirstFrame.js";

for (let repetition = 0; repetition < 12; repetition += 1) {
  const traced = repetition % 2 === 0;
  const title = `native first frame ${repetition} ${traced ? "traced" : "baseline"}`;
  const capture = traced ? startNativeCapture : () => Promise.resolve(() => Promise.resolve());

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and test fixtures.
  test(title, async ({ page }, testInfo) => {
    const stopCapture = await capture(page, testInfo);
    let firstDrawPoll: FirstDrawPoll = { kind: "not-polled" };

    try {
      await page.goto("/?sim=1&debug=1");
      const diagnostics = page.getByLabel("Render diagnostics");
      await expect
        .poll(async () => {
          const rawCalls = await diagnostics.getAttribute("data-calls");
          firstDrawPoll = { kind: "polled", rawCalls };

          return Number(rawCalls);
        })
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
    } catch (error) {
      await captureFirstFrameFailure(page, testInfo, firstDrawPoll);
      throw error;
    } finally {
      await stopCapture();
    }
  });
}
