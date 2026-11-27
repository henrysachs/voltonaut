/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and test fixtures. */
import {
  expect,
  test,
  type ConsoleMessage,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { routePresentation } from "../src/world/routeCatalog.js";

const NO_BUDGET = { maxDrawCalls: 0, maxTriangles: 0 };
const CITY_BUDGET = routePresentation("night-city")?.budget ?? NO_BUDGET;
const TOUR_BUDGET = routePresentation("voltonaut-tour")?.budget ?? NO_BUDGET;

/** Inside the neon-sprint segment (800–1800 m) of the night city loop. */
const NEON_SPRINT_M = 950;

function consoleErrors(
  message: Readonly<Pick<ConsoleMessage, "type" | "text">>,
): readonly string[] {
  return message.type() === "error" ? [message.text()] : [];
}

function collectErrors(page: Page): readonly string[] {
  const errors: string[] = [];

  page.on("pageerror", (error: Readonly<Error>) => {
    errors.push(error.message);
  });
  page.on("console", (message: Readonly<Pick<ConsoleMessage, "type" | "text">>) => {
    errors.push(...consoleErrors(message));
  });

  return errors;
}

async function diagnostic(debug: Locator, name: string): Promise<number> {
  return Number(await debug.getAttribute(`data-${name}`));
}

async function rideTo(debug: Locator, distanceM: number): Promise<void> {
  await expect
    .poll(() => diagnostic(debug, "distance-m"), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(distanceM);
}

/** Asserts the render budget and records it next to its screenshot. */
async function shoot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  budget: Readonly<typeof NO_BUDGET>,
): Promise<void> {
  const debug = page.getByLabel("Render diagnostics");
  const distanceM = await diagnostic(debug, "distance-m");
  const calls = await diagnostic(debug, "calls");
  const triangles = await diagnostic(debug, "triangles");

  testInfo.annotations.push({
    type: "render-budget",
    description: `${name} at ${distanceM.toFixed(0)} m: ${calls} draw calls, ${triangles} triangles`,
  });
  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(budget.maxDrawCalls);
  expect(triangles).toBeLessThanOrEqual(budget.maxTriangles);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

async function startRide(page: Page, query: string): Promise<Locator> {
  await page.goto(`/?sim=1&debug=1${query}`);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.getByLabel("3D ride scene")).toHaveAttribute("aria-busy", "false");

  return page.getByLabel("Render diagnostics");
}

test("night city renders three cockpit views and a day view within its budget", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  const errors = collectErrors(page);
  const night = await startRide(page, "&route=night-city&time=20:00&clock=fast");

  await rideTo(night, 60);
  await shoot(page, testInfo, "night-city-night-start", CITY_BUDGET);
  await rideTo(night, NEON_SPRINT_M);
  await shoot(page, testInfo, "night-city-night-sprint", CITY_BUDGET);
  await rideTo(night, 2600);
  await shoot(page, testInfo, "night-city-night-far-side", CITY_BUDGET);

  const day = await startRide(page, "&route=night-city&time=12:00");

  await rideTo(day, 15);
  await shoot(page, testInfo, "night-city-day", CITY_BUDGET);
  expect(errors).toEqual([]);
});

test("the voltonaut tour keeps its budget with the night bloom on", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const tour = await startRide(page, "&route=voltonaut-tour&time=21:00");

  await rideTo(tour, 10);
  await shoot(page, testInfo, "voltonaut-tour-night", TOUR_BUDGET);
  expect(errors).toEqual([]);
});
