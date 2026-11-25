/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser page and request fixtures. */
import { expect, test, type Page, type Request as PlaywrightRequest } from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";

function watchProgressRequests(page: Readonly<Page>): string[] {
  const urls: string[] = [];

  page.on("request", (request: Readonly<PlaywrightRequest>) => {
    if (/\/(?:v1\/)?progress(?:\/|$)|\/v1\/me\/progress-consent/u.test(request.url())) {
      urls.push(request.url());
    }
  });

  return urls;
}

test("guest progress controls explain consent and sim exclusion while the ride continues", async ({
  page,
}: Readonly<{ page: Readonly<Page> }>) => {
  const progressRequests = watchProgressRequests(page);

  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Konto");

  const panel = page.getByRole("tabpanel", { name: "Konto", exact: true });

  await expect(panel).toContainText("Automatischer Fahrtfortschritt");
  await expect(panel).toContainText("Sim wird nie erfasst");
  await expect(panel).toContainText("Gast. Automatischer Progress benötigt ein Konto.");
  await expect(
    panel.getByRole("button", { name: "Automatischen Fahrtfortschritt aktivieren" }),
  ).toBeHidden();

  const diagnostics = page.getByLabel("Render diagnostics");
  const distanceM = Number(await diagnostics.getAttribute("data-distance-m"));

  expect(Number.isFinite(distanceM)).toBe(true);
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
    .toBeGreaterThan(distanceM + 2);
  expect(progressRequests).toEqual([]);
});
