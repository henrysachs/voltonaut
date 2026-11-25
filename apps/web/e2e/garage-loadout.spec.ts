/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser pages, contexts and routes. */
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { DEFAULT_AVATAR_CONFIG, defaultInventoryItemIds } from "@voltonaut/rules";
import { LoadoutUpdateSchema, PurchaseRequestSchema, type AvatarConfig } from "@voltonaut/shared";

import { openGameMenu } from "./helpers/gameMenu.js";

const API = "http://127.0.0.1:3000";
const TOKEN = "s".repeat(43);

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

/** In-memory account server; its state outlives reloads and browser contexts like a real one. */
class LoadoutServer {
  balance = 5000;
  owned: string[] = [];
  loadout: AvatarConfig = DEFAULT_AVATAR_CONFIG;
  updatedAt: string | null = null;
  rejectSaves = false;
  readonly loadoutRequests: string[] = [];

  inventory() {
    return {
      items: [
        ...defaultInventoryItemIds().map((itemId) => ({
          itemId,
          source: "default",
          acquiredAt: null,
        })),
        ...this.owned.map((itemId) => ({
          itemId,
          source: "shop",
          acquiredAt: "2026-11-25T12:00:00.000Z",
        })),
      ],
    };
  }

  async purchase(route: Route): Promise<void> {
    const raw: unknown = route.request().postDataJSON();
    const order = PurchaseRequestSchema.parse(raw);

    this.owned.push(order.itemId);
    this.balance -= order.expectedPriceVolts;
    await route.fulfill({
      json: {
        voltsBalance: this.balance,
        item: { itemId: order.itemId, source: "shop", acquiredAt: "2026-11-25T12:00:00.000Z" },
      },
    });
  }

  async loadoutRoute(route: Route): Promise<void> {
    this.loadoutRequests.push(route.request().method());

    if (route.request().method() === "GET") {
      await route.fulfill({ json: { loadout: this.loadout, updatedAt: this.updatedAt } });

      return;
    }

    if (this.rejectSaves) {
      await route.fulfill({ status: 409, json: { error: { code: "not_owned", message: "x" } } });

      return;
    }

    const raw: unknown = route.request().postDataJSON();

    this.loadout = LoadoutUpdateSchema.parse(raw).loadout;
    this.updatedAt = "2026-11-25T12:00:00.000Z";
    await route.fulfill({ json: { loadout: this.loadout, updatedAt: this.updatedAt } });
  }

  async attach(target: Page | BrowserContext): Promise<void> {
    await target.addInitScript(
      ({ apiOrigin, sessionToken }) => {
        localStorage.setItem(
          `voltonaut.application-session:${apiOrigin}`,
          JSON.stringify({ sessionToken }),
        );
      },
      { apiOrigin: API, sessionToken: TOKEN },
    );
    // Fallback first: Playwright matches the most recently registered route first.
    await target.route(`${API}/**`, (route) => route.fulfill({ status: 404, json: {} }));
    await target.route(`${API}/v1/me`, (route) => route.fulfill({ json: { user: USER } }));
    await target.route(`${API}/v1/me/profile`, (route) =>
      route.fulfill({ json: { status: "missing" } }),
    );
    await target.route(`${API}/v2/rides`, (route) =>
      route.fulfill({ json: { rides: [], nextCursor: null } }),
    );
    await target.route(`${API}/v1/me/volts`, (route) =>
      route.fulfill({ json: { voltsBalance: this.balance } }),
    );
    await target.route(`${API}/v1/me/inventory`, (route) =>
      route.fulfill({ json: this.inventory() }),
    );
    await target.route(`${API}/v1/shop/purchase`, (route) => this.purchase(route));
    await target.route(`${API}/v1/me/loadout`, (route) => this.loadoutRoute(route));
  }
}

async function openGarage(page: Page, url = "/?sim=1&debug=1"): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
}

function lookOf(page: Page) {
  return page.getByLabel("Render diagnostics");
}

test("buys and equips a jersey that survives reload, a second browser and shows in the ride", async ({
  page,
  browser,
}) => {
  const server = new LoadoutServer();

  await server.attach(page);
  await openGarage(page);
  await page.getByTestId("garage-item-jersey.stripe").click();
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("1.500 ⚡");
  await expect(page.getByTestId("garage-equip")).toBeDisabled();
  await page.getByTestId("garage-purchase").click();
  await page.getByTestId("garage-purchase-confirm").click();
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Im Besitz");

  const distanceM = Number(await lookOf(page).getAttribute("data-distance-m"));

  await page.getByTestId("garage-equip").click();
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Ausgerüstet");
  await expect(page.getByTestId("garage-equip")).toHaveText("Ausgerüstet");
  expect(server.loadout.rider.jerseyId).toBe("jersey.stripe");
  await expect(lookOf(page)).toHaveAttribute("data-look", /"jerseyId":"jersey\.stripe"/u);
  await expect
    .poll(async () => Number(await lookOf(page).getAttribute("data-distance-m")))
    .toBeGreaterThan(distanceM);

  await page.reload();
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
  await expect(page.getByTestId("garage-item-name")).toHaveText("Blitzstreifen");
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Ausgerüstet");

  // A second browser later on, as in real use; one software-rendered 3D scene at a time.
  await page.close();

  const second = await browser.newContext();
  const other = await second.newPage();

  await server.attach(other);
  await openGarage(other);
  await expect(other.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Ausgerüstet");
  await expect(lookOf(other)).toHaveAttribute("data-look", /"jerseyId":"jersey\.stripe"/u);
  await second.close();
});

test("a rejected save shows the server state and a discard returns to the equipment", async ({
  page,
}) => {
  const server = new LoadoutServer();

  server.owned = ["jersey.stripe"];
  server.rejectSaves = true;
  await server.attach(page);
  await openGarage(page);
  await page.getByTestId("garage-item-jersey.stripe").click();
  await page.getByTestId("garage-equip").click();
  await expect(page.getByTestId("garage-equip-hint")).toContainText("Ausrüsten abgelehnt");
  await expect(page.getByTestId("garage-item-status-jersey.classic")).toHaveText("Ausgerüstet");

  await page.getByTestId("garage-item-jersey.stripe").click();
  await page.getByTestId("garage-discard").click();
  await expect(page.getByTestId("garage-item-name")).toHaveText("Voltonaut Classic");
  expect(server.loadout).toEqual(DEFAULT_AVATAR_CONFIG);
});

test("equipping works without WebGL and a guest sends no loadout request", async ({
  page,
  browser,
}) => {
  const server = new LoadoutServer();

  server.owned = ["jersey.stripe"];
  await page.addInitScript({
    content: `
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, options) {
        if (type === "webgl" || type === "webgl2") return null;
        return original.call(this, type, options);
      };
    `,
  });
  await server.attach(page);
  await openGarage(page, "/?sim=1");
  await expect(page.getByTestId("garage-preview")).toHaveAttribute(
    "data-preview-state",
    "unavailable3d",
  );
  await page.getByTestId("garage-item-jersey.stripe").click();
  await page.getByTestId("garage-equip").click();
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Ausgerüstet");
  expect(server.loadout.rider.jerseyId).toBe("jersey.stripe");

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const requests: string[] = [];

  guest.on("request", (request) => {
    requests.push(request.url());
  });
  await openGarage(guest, "/?sim=1");
  await expect(guest.getByTestId("garage-equip")).toBeHidden();
  expect(requests.filter((url) => url.includes("/v1/me/loadout"))).toEqual([]);
  await guestContext.close();
});
/* oxlint-enable typescript/prefer-readonly-parameter-types */
