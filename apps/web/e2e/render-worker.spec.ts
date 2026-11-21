import { expect, test } from "@playwright/test";

import {
  captureRenderWorker,
  countCanvasTransfers,
  holdRenderWorker,
  LOSE_RENDER_CONTEXT,
  renderWorkerPrelude,
} from "./render-worker.helpers.js";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns page/testInfo and their browser resources.
test("keeps input live while the renderer loads", async ({ page }, testInfo) => {
  await countCanvasTransfers(page);
  const world = page.getByRole("region", { name: "Ride world" });
  const debug = page.getByLabel("Render diagnostics");
  const canvas = page.getByLabel("3D ride scene");

  await holdRenderWorker(page, async () => {
    await page.goto("/?sim=1&debug=1", { waitUntil: "domcontentloaded" });
    await expect(world.getByRole("status", { name: "", exact: true })).toContainText(
      "Preparing 3D",
    );
    await expect(canvas).toHaveAttribute("aria-busy", "true");
    await expect(debug).not.toHaveAttribute("data-calls");
    await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("hud-gear")).toHaveText("13");
  });
  await expect
    .poll(async () => Number(await debug.getAttribute("data-triangles")))
    .toBeGreaterThan(80_000);
  await expect(debug).toHaveAttribute("data-frame-stage", "after-render-task");
  await expect(canvas).toHaveAttribute("data-transfer-count", "1");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await expect(world.getByRole("status", { name: "", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("actual-worker-world.png") });
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("reports actual worker WebGL initialization failure without losing the ride", async ({
  page,
}) => {
  await renderWorkerPrelude(page, "OffscreenCanvas.prototype.getContext = () => null;");
  await page.goto("/?sim=1&clock=fast");
  await expect(
    page
      .getByRole("region", { name: "Ride world" })
      .getByRole("status")
      .filter({ hasText: "3D unavailable" }),
  ).toHaveText("3D unavailable. Your ride, devices and HUD still work.");
  await expect(page.getByLabel("3D ride scene")).toHaveCount(0);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect(page.getByTestId("hud-distance")).not.toHaveText("0.00 km");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("releases real worker context loss and keeps HUD and keyboard usable", async ({ page }) => {
  await captureRenderWorker(page);
  await renderWorkerPrelude(page, LOSE_RENDER_CONTEXT);
  await page.goto("/?sim=1&clock=fast&debug=1");
  await expect(page.locator("body")).toHaveAttribute("data-render-ready", "true");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("test-lose-render-context"));
  });
  await expect(
    page
      .getByRole("region", { name: "Ride world" })
      .getByRole("status")
      .filter({ hasText: "3D unavailable" }),
  ).toHaveText("3D unavailable. Your ride, devices and HUD still work.");
  await expect(page.getByLabel("3D ride scene")).toHaveCount(0);
  await expect(page.getByLabel("Render diagnostics")).toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect(page.locator("body")).toHaveAttribute("data-render-terminations", "1");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("disposes during startup and ignores late worker replies after pagehide", async ({ page }) => {
  await captureRenderWorker(page);
  await holdRenderWorker(page, async () => {
    await page.goto("/?sim=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Preparing 3D.", { exact: false })).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await expect(page.getByLabel("3D ride scene")).toHaveCount(0);
    await expect(page.getByLabel("Render diagnostics")).toHaveCount(0);
  });
  await expect(page.locator("body")).toHaveAttribute("data-render-terminations", "1");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  await expect(page.getByRole("region", { name: "Ride world" })).toBeEmpty();
  await expect(page.locator("body")).toHaveAttribute("data-render-terminations", "1");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("does not switch camera while a profile field owns keyboard input", async ({ page }) => {
  await page.goto("/?sim=1&debug=1");
  const debug = page.getByLabel("Render diagnostics");

  await expect(debug).toHaveAttribute("data-camera", "chase");
  await page.getByRole("textbox", { name: "Name", exact: true }).focus();
  await page.keyboard.press("c");
  await expect(page.getByRole("button", { name: "Camera: chase" })).toBeVisible();
  await page.getByRole("button", { name: "Camera: chase" }).click();
  await expect(debug).toHaveAttribute("data-camera", "overview");
});
