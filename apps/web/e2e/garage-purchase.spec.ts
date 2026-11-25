/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser page and routes. */
import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { PurchaseRequestSchema } from "@voltonaut/shared";

import { openGameMenu } from "./helpers/gameMenu.js";

const API = "http://127.0.0.1:3000";
const TOKEN = "s".repeat(43);

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

interface ShopServer {
  readonly purchases: { readonly itemId: string; readonly expectedPriceVolts: number }[];
  balance: number;
}

async function fulfillPurchase(route: Route, server: ShopServer): Promise<void> {
  const raw: unknown = route.request().postDataJSON();
  const order = PurchaseRequestSchema.parse(raw);

  server.purchases.push({ itemId: order.itemId, expectedPriceVolts: order.expectedPriceVolts });
  server.balance -= order.expectedPriceVolts;
  await route.fulfill({
    json: {
      voltsBalance: server.balance,
      item: { itemId: order.itemId, source: "shop", acquiredAt: "2026-11-25T12:00:00.000Z" },
    },
  });
}

async function signedInGarage(page: Page): Promise<ShopServer> {
  const server: ShopServer = { purchases: [], balance: 2000 };

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
    route.fulfill({ json: { voltsBalance: server.balance } }),
  );
  await page.route(`${API}/v1/me/inventory`, (route) =>
    route.fulfill({
      json: { items: [{ itemId: "jersey.classic", source: "default", acquiredAt: null }] },
    }),
  );
  // The server always answers the loadout read since E7-05; the default loadout keeps the garage ready.
  await page.route(`${API}/v1/me/loadout`, (route) =>
    route.fulfill({ json: { loadout: DEFAULT_AVATAR_CONFIG, updatedAt: null } }),
  );
  await page.route(`${API}/v1/shop/purchase`, (route) => fulfillPurchase(route, server));
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
  await page.getByTestId("garage-item-jersey.stripe").click();
  await expect(page.getByTestId("garage-purchase")).toHaveText("Kaufen (1.500 ⚡)");

  return server;
}

test("a purchase needs an explicit confirmation and sends exactly one request", async ({
  page,
}) => {
  const server = await signedInGarage(page);
  const purchase = page.getByTestId("garage-purchase");
  const cancel = page.getByTestId("garage-purchase-cancel");
  const confirm = page.getByTestId("garage-purchase-confirm");

  await purchase.click();
  await expect(page.getByTestId("garage-purchase-confirmation")).toContainText(
    "„Blitzstreifen“ für 1.500 ⚡ kaufen? Kontostand danach: 500 ⚡.",
  );
  await expect(cancel).toBeFocused();
  await expect(page.getByRole("group", { name: "Kauf bestätigen", exact: true })).toBeVisible();
  await expect(confirm).toHaveAttribute("aria-describedby", "garage-purchase-question");
  await expect(cancel).toHaveAttribute("aria-describedby", "garage-purchase-question");

  // A repeated Enter toggles between button and „Abbrechen“; it never confirms.
  await page.keyboard.press("Enter");
  await expect(purchase).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(purchase).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();

  // A held Enter sends repeated keydowns; focus stays off the confirm button.
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(confirm).not.toBeFocused();
  await expect(purchase).toBeFocused();
  expect(server.purchases).toEqual([]);

  await purchase.click();
  await confirm.dblclick();
  await expect(purchase).toHaveText("Im Besitz");
  await expect(page.getByTestId("garage-purchase-hint")).toContainText("Gekauft.");
  expect(server.purchases).toEqual([{ itemId: "jersey.stripe", expectedPriceVolts: 1500 }]);
});

test("switching the item closes an open confirmation without buying", async ({ page }) => {
  const server = await signedInGarage(page);

  await page.getByTestId("garage-purchase").click();
  await page.getByTestId("garage-item-jersey.classic").click();

  await expect(page.getByTestId("garage-purchase-confirmation")).toBeHidden();
  await expect(page.getByTestId("garage-purchase")).toHaveText("Im Besitz");
  expect(server.purchases).toEqual([]);
});
/* oxlint-enable typescript/prefer-readonly-parameter-types */
