/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser page and routes. */
import { expect, test, type Page } from "@playwright/test";

import { openGameMenu } from "./helpers/gameMenu.js";

const API = "http://127.0.0.1:3000";
const TOKEN = "s".repeat(43);

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const JOURNAL = {
  journalId: "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f",
  routeId: "test-loop",
  startedAt: "2026-11-26T08:00:00.000Z",
  lastConfirmedAt: "2026-11-26T08:30:00.000Z",
  confirmedTicks: 36_000,
  rangeCount: 3,
  rewardDays: ["2026-11-26"],
  awardedVolts: 1200,
  withheldVolts: 5,
  candidateVolts: 1205,
};

/** Signed-in browser against a mocked account server with one confirmed journal. */
async function signedIn(page: Page, history: { fail: boolean; reads: number }): Promise<void> {
  await page.addInitScript(
    ({ apiOrigin, sessionToken }) => {
      localStorage.setItem(
        `voltonaut.application-session:${apiOrigin}`,
        JSON.stringify({ sessionToken }),
      );
    },
    { apiOrigin: API, sessionToken: TOKEN },
  );
  // Fallback first: Playwright matches the most recently registered route first.
  await page.route(`${API}/**`, (route) => route.fulfill({ status: 404, json: {} }));
  await page.route(`${API}/v1/me`, (route) => route.fulfill({ json: { user: USER } }));
  await page.route(`${API}/v1/me/profile`, (route) =>
    route.fulfill({ json: { status: "missing" } }),
  );
  await page.route(`${API}/v2/rides`, (route) =>
    route.fulfill({ json: { rides: [], nextCursor: null } }),
  );
  await page.route(`${API}/v1/me/volts`, (route) =>
    route.fulfill({ json: { voltsBalance: 3400 } }),
  );
  await page.route(`${API}/v1/me/progress-history`, (route) => {
    history.reads += 1;

    return history.fail
      ? route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "x" } } })
      : route.fulfill({ json: { journals: [JOURNAL], nextCursor: null } });
  });
}

function volts(page: Page) {
  return page.getByTestId("hud-volts");
}

async function previewVolts(page: Page): Promise<number> {
  await expect(volts(page)).toHaveAttribute("data-preview-volts", /^\d/u);

  return Number(await volts(page).getAttribute("data-preview-volts"));
}

test("the HUD preview grows during a sim ride without a confirmed value", async ({ page }) => {
  await page.goto("/?sim=1&clock=fast");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(volts(page)).toHaveAttribute("data-status", "sim");
  await expect(volts(page)).toContainText("– bestätigt · Sim – keine Serverbuchung");

  const first = await previewVolts(page);

  await expect.poll(() => previewVolts(page), { timeout: 20_000 }).toBeGreaterThan(first);
  await expect(volts(page)).toHaveAttribute("data-confirmed-volts", "");

  // The ride keeps running while the account menu is open.
  await openGameMenu(page, "Konto");
  await expect(page.getByTestId("progress-history-status")).toHaveText(
    "Bestätigte Fahrten erscheinen nach der Anmeldung.",
  );
});

test("the confirmed history and balance are the same after a reload", async ({ page }) => {
  const history = { fail: false, reads: 0 };

  await signedIn(page, history);
  await page.goto("/?sim=1");
  await openGameMenu(page, "Konto");

  const status = page.getByTestId("progress-history-status");
  const list = page.getByTestId("progress-history-list");

  await expect(status).toHaveText("Kontostand laut Server: 3.400 ⚡.");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("1.200 ⚡ bestätigt · 5 ⚡ über Tageslimit · 3 Abschnitte");

  await page.reload();
  await openGameMenu(page, "Konto");
  await expect(status).toHaveText("Kontostand laut Server: 3.400 ⚡.");
  await expect(list).toContainText("1.200 ⚡ bestätigt");

  // Without an answer the history shows no numbers; a manual reload reads again.
  history.fail = true;
  await page.getByRole("button", { name: "Historie neu laden" }).click();
  await expect(status).toHaveText("Historie nicht erreichbar. Kein bestätigter Stand angezeigt.");
  await expect(list.getByRole("listitem")).toHaveCount(0);
  expect(history.reads).toBe(3);
});
/* oxlint-enable typescript/prefer-readonly-parameter-types */
