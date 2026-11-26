/// <reference types="node" />
/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns mutable browser fixtures and native CDP input. */
import { Buffer } from "node:buffer";

import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { PreviewOrbit } from "../../src/ui/garage/previewOrbit.js";
import { openGameMenu } from "./gameMenu.js";

export interface PageFixture {
  readonly page: Readonly<Page>;
}

export function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing required browser value");

  return value;
}

export async function openGarage(page: Readonly<Page>): Promise<Locator> {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
  const preview = page.getByTestId("garage-preview");
  await expect(preview).toHaveAttribute("data-preview-state", "preview");
  await expect(preview.locator("canvas")).toHaveAttribute("data-preview-ready", "true");
  await preview.scrollIntoViewIfNeeded();

  return preview;
}

export async function readOrbit(preview: Readonly<Locator>): Promise<Readonly<PreviewOrbit>> {
  return {
    yawRad: Number(await preview.getAttribute("data-orbit-yaw-rad")),
    pitchRad: Number(await preview.getAttribute("data-orbit-pitch-rad")),
  };
}

export async function attachScreenshot(
  page: Readonly<Page>,
  testInfo: Readonly<TestInfo>,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

export async function touchDrag(
  page: Readonly<Page>,
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });

  for (let step = 1; step <= 4; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Native touch moves must arrive in pointer order.
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX + (deltaX * step) / 4, y: startY + (deltaY * step) / 4, id: 1 }],
    });
  }

  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

export async function expectPhotoChromeHidden(page: Readonly<Page>): Promise<void> {
  const selectors = [
    ".hud",
    ".ride-title",
    "#game-notices",
    ".scene__camera",
    ".scene__debug",
    ".game-menu__header",
    ".game-menu__tabs",
    ".game-menu__footer",
    ".garage__heading",
    ".garage__intro",
    ".garage__status",
    ".garage__slots",
    ".garage__browse",
    ".garage__details",
    ".garage__preview-title",
    ".garage__preview-note",
    ".garage__preview-controls",
  ];

  await Promise.all(selectors.map((selector) => expect(page.locator(selector)).toBeHidden()));

  await expect(page.locator(".game-menu__focus-guard").first()).toBeHidden();
}

export async function expectPhotoStageSized(
  preview: Readonly<Locator>,
  canvas: Readonly<Locator>,
): Promise<void> {
  await expect
    .poll(async () => {
      const host = await preview.evaluate((element: Readonly<HTMLElement>) => ({
        width: element.clientWidth,
        height: element.clientHeight,
      }));

      const target = await canvas.evaluate((element: Readonly<HTMLCanvasElement>) => ({
        width: element.width,
        height: element.height,
      }));

      return {
        widthDifference: host.width - target.width,
        heightDifference: host.height - target.height,
      };
    })
    .toEqual({ widthDifference: 0, heightDifference: 0 });
  const stage = required(await preview.boundingBox());
  const viewport = required(preview.page().viewportSize());
  expect(stage.width).toBeGreaterThan(1000);
  expect(stage.height).toBeGreaterThan(400);
  expect(stage.width).toBeLessThan(viewport.width);
  expect(stage.height).toBeLessThan(viewport.height);
}

export function pngDimensions(bytes: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("Download is not a PNG");

  if (bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("PNG has no IHDR chunk");

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function hasOpaquePngPixel(page: Readonly<Page>, bytes: Buffer): Promise<boolean> {
  return page.evaluate(async (base64: string) => {
    const binary = atob(base64);
    const pixels = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
    const url = URL.createObjectURL(new Blob([pixels], { type: "image/png" }));

    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");

      if (context === null) throw new Error("PNG decode context unavailable");

      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;

      return data.some((channel, index) => index % 4 === 3 && channel > 0);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, bytes.toString("base64"));
}
