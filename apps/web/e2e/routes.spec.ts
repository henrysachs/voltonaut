import { expect, test, type Locator, type Page } from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";
import { ROUTE_CATALOG } from "../src/world/routeCatalog.js";

const CATALOG_IDS: readonly string[] = ROUTE_CATALOG.map((entry) => entry.id);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("Strecke tab offers the six catalog routes with previews and marks the current one", async ({
  page,
}) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Strecke");

  const panel = page.getByRole("tabpanel", { name: "Strecke", exact: true });

  await expect(panel.locator(".route-card")).toHaveCount(6);
  await expect(panel.getByText(/lädt die Seite neu/u)).toBeVisible();

  await Promise.all(
    ROUTE_CATALOG.map(async (entry) => {
      const card = panel.locator(`.route-card[data-route-id="${entry.id}"]`);

      await expect(card).toBeVisible();
      await expect(card.locator("h3")).toHaveText(entry.title);
      await expect(card.locator("svg")).toBeVisible();
      await expect(card.locator("svg path")).toHaveAttribute("d", /^M -?\d/u);
      await expect(card.locator(".route-card__meta")).toContainText("km ·");
      await expect(card.locator(".route-card__description")).toHaveText(entry.description);
    }),
  );

  await expect(panel.locator('.route-card[data-current="true"]')).toHaveCount(1);
  await expect(panel.locator('.route-card[data-current="true"] h3')).toHaveText("Test Loop");
  await expect(page.getByTestId("route-select-test-loop")).toBeDisabled();
  await expect(page.getByTestId("route-select-coast-loop")).toBeEnabled();
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("selecting a route sets the route param, keeps sim and debug and reloads", async ({
  page,
}) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Strecke");
  await page.getByTestId("route-select-alpine-pass").click();

  await page.waitForURL(/route=alpine-pass/u);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.locator("#ride-route-identity")).toHaveText("ALPINE PASS / 28.4 KM");

  const url = new URL(page.url());

  expect(url.searchParams.get("route")).toBe("alpine-pass");
  expect(url.searchParams.get("sim")).toBe("1");
  expect(url.searchParams.get("debug")).toBe("1");

  await openGameMenu(page, "Strecke");
  await expect(page.getByTestId("route-select-alpine-pass")).toBeDisabled();
  await expect(page.getByTestId("route-select-test-loop")).toBeEnabled();
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("unknown route ids keep the default ride and header identity", async ({ page }) => {
  await page.goto("/?sim=1&route=does-not-exist");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.locator("#ride-route-identity")).toHaveText("TEST LOOP / 10 KM");
});

for (const entry of ROUTE_CATALOG) {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
  test(`route ${entry.id} renders within its catalog budget`, async ({ page }) => {
    await page.goto(`/?sim=1&debug=1&route=${entry.id}`);
    await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");

    const diagnostics = page.getByLabel("Render diagnostics");

    await expect
      .poll(async () => Number(await diagnostics.getAttribute("data-calls")))
      .toBeGreaterThan(0);

    const calls = Number(await diagnostics.getAttribute("data-calls"));
    const triangles = Number(await diagnostics.getAttribute("data-triangles"));

    expect(calls).toBeLessThanOrEqual(entry.budget.maxDrawCalls);
    expect(triangles).toBeLessThanOrEqual(entry.budget.maxTriangles);
    expect(await diagnostics.getAttribute("data-weather")).toBeTruthy();
    await expect(page.locator("#ride-route-identity")).toContainText(entry.title.toUpperCase());
    expect(CATALOG_IDS).toContain(entry.id);
  });
}

/** A number from the render diagnostics overlay. */
async function diagnostic(
  source: Readonly<Pick<Locator, "getAttribute">>,
  name: string,
): Promise<number> {
  return Number(await source.getAttribute(`data-${name}`));
}

interface TrackedRide {
  /** Waits until the ride passed the distance; the distance only grows, the world keeps drawing. */
  readonly rideTo: (distanceM: number) => Promise<void>;
  readonly peaks: () => { readonly calls: number; readonly triangles: number };
}

/** Follows a ride through the render diagnostics and records the draw call and triangle peaks. */
function trackRide(
  page: Readonly<Pick<Page, "getByLabel" | "getByTestId" | "locator">>,
): TrackedRide {
  const diagnostics = page.getByLabel("Render diagnostics");
  const canvas = page.locator('canvas[aria-label="3D ride scene"]');
  const peak = { calls: 0, triangles: 0 };
  let lastDistanceM = 0;

  async function sample(): Promise<number> {
    peak.calls = Math.max(peak.calls, await diagnostic(diagnostics, "calls"));
    peak.triangles = Math.max(peak.triangles, await diagnostic(diagnostics, "triangles"));

    const now = await diagnostic(diagnostics, "distance-m");

    expect(now).toBeGreaterThanOrEqual(lastDistanceM);
    lastDistanceM = now;
    await expect(canvas).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");

    return now;
  }

  return {
    rideTo: async (distanceM) => {
      await expect.poll(sample, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(distanceM);
    },
    peaks: () => ({ ...peak }),
  };
}

/** Distances (m) along the voltonaut tour of revision 2 where the vineyard region begins and ends. */
const TOUR_VINEYARD_ENTRY_M = 3560;
const TOUR_VINEYARD_EXIT_M = 12_739;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("the tour rides into the vineyard region and out again without a break (#146)", async ({
  page,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable test info.
}, testInfo) => {
  test.setTimeout(420_000);

  const errors: string[] = [];

  page.on("pageerror", (error: Readonly<Error>) => {
    errors.push(error.message);
  });
  await page.goto("/?sim=1&clock=fast&debug=1&route=voltonaut-tour");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");

  const diagnostics = page.getByLabel("Render diagnostics");
  const ride = trackRide(page);

  const shoot = (name: string): Promise<Buffer> =>
    page.screenshot({ path: testInfo.outputPath(`vineyard-${name}.png`) });

  await page.keyboard.press("ArrowUp");
  await ride.rideTo(TOUR_VINEYARD_ENTRY_M + 150);
  await shoot("transition-chase");
  await ride.rideTo(TOUR_VINEYARD_ENTRY_M + 2600);
  await shoot("chase");
  await page.getByRole("button", { name: "Camera: chase" }).click();
  await expect(diagnostics).toHaveAttribute("data-camera", "overview");
  await shoot("overview");
  await page.keyboard.press("c");
  await expect(diagnostics).toHaveAttribute("data-camera", "chase");
  await ride.rideTo(TOUR_VINEYARD_EXIT_M + 400);

  expect(ride.peaks().calls).toBeLessThanOrEqual(150);
  expect(ride.peaks().triangles).toBeLessThanOrEqual(500_000);
  expect(errors).toEqual([]);
  await testInfo.attach("vineyard-tour-budget", {
    body: `peak draw calls ${ride.peaks().calls}, peak triangles ${ride.peaks().triangles}`,
    contentType: "text/plain",
  });
});
