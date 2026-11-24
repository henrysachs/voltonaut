import { expect, test, type Locator } from "@playwright/test";
import { openGameMenu } from "./helpers/gameMenu.js";

function overlapArea(
  elements: readonly Readonly<Pick<Element, "getBoundingClientRect">>[],
): number {
  const first = elements[0];
  const second = elements[1];

  if (first === undefined || second === undefined) throw new Error("two cockpit panels required");
  const a = first.getBoundingClientRect();
  const b = second.getBoundingClientRect();

  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

const metricIds: readonly string[] = [
  "hud-powerW",
  "hud-cadenceRpm",
  "hud-heartRateBpm",
  "hud-gear",
  "hud-speed",
  "hud-distance",
  "hud-elevationGain",
  "hud-energy",
];

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
  test(`cockpit overlays a full-window world at ${viewport.width} by ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?sim=1");
    await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
    expect(await page.locator("#ride-scene").boundingBox()).toEqual({
      x: 0,
      y: 0,
      ...viewport,
    });
    const values = page.locator(".hud__value");
    await expect(values).toHaveCount(metricIds.length);
    await Promise.all(
      (await values.all()).map((value: Readonly<Locator>) =>
        expect(value).toBeInViewport({ ratio: 1 }),
      ),
    );
    expect(
      await page
        .locator(".hud__value dd")
        .evaluateAll(
          (elements: readonly Readonly<Pick<Element, "id" | "scrollWidth" | "clientWidth">>[]) =>
            elements.map((element) => ({
              id: element.id,
              fits: element.scrollWidth <= element.clientWidth,
            })),
        ),
    ).toEqual(metricIds.map((id) => ({ id, fits: true })));
    await expect(page.getByRole("button", { name: "Menü", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page.getByRole("button", { name: "Geräte verbinden", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("tablet segment preview never overlaps the ride controls", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const panels = page.locator(".hud__segments, #game-header-actions");
  await expect(panels).toHaveCount(2);
  expect(await panels.evaluateAll(overlapArea)).toBe(0);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("recording controls precede optional technical details without losing the reload warning", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  await openGameMenu(page, "Aufnahmen");
  const explanation = page.getByText("Journalaufnahmen enthalten", { exact: false });
  await expect(explanation).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Aufnahme starten", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(
    page.getByText("Ein Reload verwirft die laufende Aufnahme.", { exact: false }),
  ).toBeVisible();
  await page.getByText("Aufnahme und Datenschutz", { exact: true }).click();
  await expect(explanation).toBeVisible();
});
