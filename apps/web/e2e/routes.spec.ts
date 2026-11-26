import { expect, test } from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";
import { ROUTE_CATALOG } from "../src/world/routeCatalog.js";

const CATALOG_IDS: readonly string[] = ROUTE_CATALOG.map((entry) => entry.id);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("Strecke tab offers the four catalog routes with previews and marks the current one", async ({
  page,
}) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Strecke");

  const panel = page.getByRole("tabpanel", { name: "Strecke", exact: true });

  await expect(panel.locator(".route-card")).toHaveCount(4);
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
