import { expect, test, type ConsoleMessage } from "@playwright/test";

interface AttributeSource {
  readonly getAttribute: (name: string) => Promise<string | null>;
}

async function diagnostic(source: AttributeSource, name: string): Promise<number> {
  return Number(await source.getAttribute(`data-${name}`));
}

function consoleErrors(
  message: Readonly<Pick<ConsoleMessage, "type" | "text">>,
): readonly string[] {
  return message.type() === "error" ? [message.text()] : [];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("draws the ride, follows worker movement, switches camera and resizes", async ({ page }) => {
  const errors: string[] = [];

  page.on("pageerror", (error: Readonly<Error>) => {
    errors.push(error.message);
  });
  await page.goto("/?sim=1&clock=fast&debug=1");
  const debug = page.getByLabel("Render diagnostics");
  const canvas = page.getByLabel("3D ride scene");

  await expect.poll(() => diagnostic(debug, "calls")).toBeGreaterThan(0);
  await expect.poll(() => diagnostic(debug, "triangles")).toBeGreaterThan(100);
  expect(await diagnostic(debug, "calls")).toBeLessThanOrEqual(150);
  expect(await diagnostic(debug, "triangles")).toBeLessThanOrEqual(500_000);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const before = await diagnostic(debug, "rider-z");
  const crank = await diagnostic(debug, "crank-rad");

  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect.poll(() => diagnostic(debug, "rider-z")).toBeGreaterThan(before + 1);
  await expect.poll(() => diagnostic(debug, "crank-rad")).toBeGreaterThan(crank);
  await page.getByRole("button", { name: "Camera: chase" }).click();
  await expect(debug).toHaveAttribute("data-camera", "overview");
  await page.keyboard.press("c");
  await expect(debug).toHaveAttribute("data-camera", "chase");
  await page.setViewportSize({ width: 800, height: 900 });
  await expect.poll(() => canvas.getAttribute("width")).toBe("760");
  await expect.poll(() => diagnostic(debug, "calls")).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and test fixtures.
test("rides the lake and forest at normal speed", async ({ page }, testInfo) => {
  const errors: string[] = [];

  page.on("pageerror", (error: Readonly<Error>) => {
    errors.push(error.message);
  });
  page.on("console", (message: Readonly<Pick<ConsoleMessage, "type" | "text">>) => {
    errors.push(...consoleErrors(message));
  });
  await page.goto("/?sim=1&debug=1");
  const debug = page.getByLabel("Render diagnostics");

  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect.poll(() => diagnostic(debug, "triangles")).toBeGreaterThan(80_000);
  await expect.poll(() => diagnostic(debug, "crank-rad")).toBeGreaterThan(0);
  const distanceM = await diagnostic(debug, "distance-m");
  const positionZ = await diagnostic(debug, "rider-z");
  const crankRad = await diagnostic(debug, "crank-rad");

  await expect.poll(() => diagnostic(debug, "distance-m")).toBeGreaterThan(distanceM + 8);
  expect(await diagnostic(debug, "rider-z")).toBeGreaterThan(positionZ + 5);
  expect(await diagnostic(debug, "crank-rad")).toBeGreaterThan(crankRad);
  expect(await diagnostic(debug, "calls")).toBeLessThanOrEqual(150);
  expect(await diagnostic(debug, "triangles")).toBeLessThanOrEqual(500_000);
  await page.screenshot({ path: testInfo.outputPath("normal-worker-chase.png") });
  await page.keyboard.press("c");
  await expect(debug).toHaveAttribute("data-camera", "overview");
  expect(await diagnostic(debug, "calls")).toBeLessThanOrEqual(150);
  expect(await diagnostic(debug, "triangles")).toBeLessThanOrEqual(500_000);
  await page.screenshot({ path: testInfo.outputPath("normal-worker-overview.png") });
  expect(errors).toEqual([]);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("releases a lost WebGL context without stopping the ride", async ({ page }) => {
  await page.goto("/?sim=1&clock=fast&debug=1");
  const debug = page.getByLabel("Render diagnostics");

  await expect.poll(() => diagnostic(debug, "calls")).toBeGreaterThan(0);
  await page.evaluate(() => {
    document
      .querySelector("canvas")
      ?.getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  });
  await expect(page.getByRole("region", { name: "Ride world" }).getByRole("status")).toContainText(
    "3D unavailable",
  );
  await expect(page.getByLabel("3D ride scene")).toHaveCount(0);
  await expect(page.getByLabel("Render diagnostics")).toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
});
