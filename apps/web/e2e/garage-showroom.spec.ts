/// <reference types="node" />
/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns mutable browser fixtures and native CDP input. */
import { readFile } from "node:fs/promises";

import { expect, test, type TestInfo } from "@playwright/test";

import { DEFAULT_PREVIEW_ORBIT, MAX_PREVIEW_PITCH_RAD } from "../src/ui/garage/previewOrbit.js";
import {
  attachScreenshot,
  expectPhotoChromeHidden,
  expectPhotoStageSized,
  hasOpaquePngPixel,
  openGarage,
  pngDimensions,
  readOrbit,
  required,
  touchDrag,
  type PageFixture,
} from "./helpers/garageShowroom.js";
import { countCanvasTransfers } from "./render-worker.helpers.js";

test("mouse, real touch, and the named rotate buttons orbit the preview", async ({
  page,
}: Readonly<PageFixture>, testInfo: Readonly<TestInfo>) => {
  const preview = await openGarage(page);
  const box = required(await preview.boundingBox());
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const before = await readOrbit(preview);

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 70, centerY + 20, { steps: 5 });
  await page.mouse.up();
  const afterMouse = await readOrbit(preview);
  expect(afterMouse.yawRad).toBeLessThan(before.yawRad);
  expect(afterMouse.pitchRad).not.toBe(before.pitchRad);

  await touchDrag(page, centerX, centerY, -60, 15);
  const afterTouch = await readOrbit(preview);
  expect(afterTouch.yawRad).toBeGreaterThan(afterMouse.yawRad);
  expect(afterTouch.pitchRad).not.toBe(afterMouse.pitchRad);

  const left = page.getByRole("button", { name: "Links drehen", exact: true });
  await left.focus();
  await page.keyboard.press("Enter");
  const afterButton = await readOrbit(preview);
  expect(afterButton.yawRad).toBeCloseTo(afterTouch.yawRad - Math.PI / 6);
  const showroomPath = testInfo.outputPath("garage-showroom.png");
  await preview.screenshot({ path: showroomPath });
  await testInfo.attach("garage-showroom.png", { path: showroomPath, contentType: "image/png" });
});

test("preview arrow keys and Home do not trigger ride or menu shortcuts", async ({
  page,
}: Readonly<PageFixture>) => {
  const preview = await openGarage(page);
  const diagnostics = page.getByLabel("Render diagnostics");
  await preview.focus();
  const before = await readOrbit(preview);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  const stepped = await readOrbit(preview);
  expect(stepped.yawRad).toBeCloseTo(before.yawRad + Math.PI / 12);
  expect(stepped.pitchRad).toBeCloseTo(before.pitchRad + Math.PI / 32);

  for (let step = 0; step < 40; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Each handled key must reach the focused preview in order.
    await page.keyboard.press("ArrowUp");
  }

  expect((await readOrbit(preview)).pitchRad).toBeCloseTo(MAX_PREVIEW_PITCH_RAD);
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await expect(diagnostics).toHaveAttribute("data-camera", "chase");

  await page.keyboard.press("Home");
  const reset = await readOrbit(preview);
  expect(reset.yawRad).toBeCloseTo(DEFAULT_PREVIEW_ORBIT.yawRad);
  expect(reset.pitchRad).toBeCloseTo(DEFAULT_PREVIEW_ORBIT.pitchRad);
});

test("reduced motion stops auto-rotation and keeps manual orbit available", async ({
  page,
}: Readonly<PageFixture>) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const preview = await openGarage(page);
  const toggle = page.getByRole("button", { name: "Drehung starten", exact: true });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const canvas = preview.locator("canvas");
  const first = await canvas.screenshot();
  await page.waitForTimeout(350);
  const second = await canvas.screenshot();
  expect(second.equals(first)).toBe(true);

  const before = await readOrbit(preview);
  await preview.focus();
  await page.keyboard.press("ArrowRight");
  expect((await readOrbit(preview)).yawRad).toBeCloseTo(before.yawRad + Math.PI / 12);

  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Drehung pausieren", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await expect(page.getByRole("button", { name: "Drehung starten", exact: true })).toBeDisabled();
  await session.detach();
});

test("photo mode hides ride chrome, keeps the canvas, and Escape exits it first", async ({
  page,
}: Readonly<PageFixture>, testInfo: Readonly<TestInfo>) => {
  await countCanvasTransfers(page);
  const preview = await openGarage(page);
  const canvas = preview.locator("canvas");
  const dialog = page.getByRole("dialog", { name: "Fahrtmenü", exact: true });
  const photoButton = page.getByRole("button", { name: "Fotomodus", exact: true });
  const exit = page.getByRole("button", { name: "Fotomodus beenden", exact: true });
  await photoButton.click();
  await expect(dialog).toHaveAttribute("data-photo-mode", "true");
  await expect(page.locator("body")).toHaveClass(/garage-photo-mode/u);
  await expect(exit).toBeFocused();
  await expect(canvas).toHaveAttribute("data-transfer-count", "1");
  await expectPhotoChromeHidden(page);
  await expectPhotoStageSized(preview, canvas);
  await attachScreenshot(page, testInfo, "garage-photo-mode.png");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute("data-photo-mode");
  await expect(page.locator("body")).not.toHaveClass(/garage-photo-mode/u);
  await expect(photoButton).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Drehung pausieren", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await photoButton.click();
  await dialog.evaluate((element: HTMLDialogElement) => {
    element.close();
  });
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/garage-photo-mode/u);
});

test("photo mode downloads only the preview canvas as an opaque PNG", async ({
  page,
}: Readonly<PageFixture>, testInfo: Readonly<TestInfo>) => {
  const preview = await openGarage(page);
  await page.getByRole("button", { name: "Fotomodus", exact: true }).click();
  const canvas = preview.locator("canvas");
  await expectPhotoStageSized(preview, canvas);

  const canvasSize = await canvas.evaluate((element: Readonly<HTMLCanvasElement>) => ({
    width: element.width,
    height: element.height,
  }));

  const viewport = required(page.viewportSize());
  expect(canvasSize.width).toBeLessThan(viewport.width);
  expect(canvasSize.height).toBeLessThan(viewport.height);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG herunterladen", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("voltonaut-garage.png");
  const path = testInfo.outputPath("voltonaut-garage.png");
  await download.saveAs(path);

  const bytes = await readFile(path);
  expect(pngDimensions(bytes)).toEqual(canvasSize);
  expect(await hasOpaquePngPixel(page, bytes)).toBe(true);
  await expect(page.locator(".garage__photo-status")).toHaveText("PNG heruntergeladen.");
  await testInfo.attach("voltonaut-garage.png", { path, contentType: "image/png" });
});

/* oxlint-enable typescript/prefer-readonly-parameter-types */
