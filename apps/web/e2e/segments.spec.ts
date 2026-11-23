import { expect, test, type Page, type TestInfo } from "@playwright/test";

type SegmentPage = Readonly<
  Pick<
    Page,
    "goto" | "getByTestId" | "getByRole" | "getByLabel" | "screenshot" | "evaluate" | "locator"
  >
> & {
  readonly keyboard: Readonly<Pick<Page["keyboard"], "press">>;
};

test("ordinary Sim shows the segment preview and keeps riding through the menu", async ({
  page,
}: { readonly page: SegmentPage }, testInfo: Readonly<Pick<TestInfo, "outputPath">>) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.getByRole("region", { name: "Segmentvorschau" })).toContainText(
    "Vorläufig · Tickauflösung",
  );
  await expect(page.getByLabel("Sprint-Vorschau", { exact: true })).toHaveText(
    "Sprint · ab 2.0 km",
  );
  await expect(page.getByLabel("KOM-Vorschau", { exact: true })).toHaveText("KOM · ab 5.0 km");
  await expect(page.getByRole("region", { name: "Segmentvorschau" })).not.toHaveAttribute(
    "aria-live",
  );
  const diagnostics = page.getByLabel("Render diagnostics");
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-triangles")))
    .toBeGreaterThan(80_000);
  await page.screenshot({ path: testInfo.outputPath("segment-preview-ordinary-world.png") });
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  const distanceM = Number(await diagnostics.getAttribute("data-distance-m"));
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
    .toBeGreaterThan(distanceM + 8);
  await expect(page.getByTestId("hud-sprint")).toHaveText("Sprint · ab 2.0 km");
  await page.getByRole("button", { name: "Zurück zur Fahrt", exact: true }).click();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("#ride-scene")).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".hud")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("segment-preview-ordinary-return.png") });
});
