/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser pages, contexts and routes. */
import type { BrowserContext, Page, Route } from "@playwright/test";
import { DEFAULT_AVATAR_CONFIG, defaultInventoryItemIds } from "@voltonaut/rules";
import { LoadoutUpdateSchema, PurchaseRequestSchema, type AvatarConfig } from "@voltonaut/shared";

const API = "http://127.0.0.1:3000";
const TOKEN = "s".repeat(43);

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

/** In-memory account server; its state outlives reloads and browser contexts like a real one. */
export class LoadoutServer {
  balance = 5000;
  owned: string[] = [];
  loadout: AvatarConfig = DEFAULT_AVATAR_CONFIG;
  updatedAt: string | null = null;
  rejectSaves = false;
  /** Answers balance reads with 503, like an API that is restarting. */
  failVolts = false;
  voltsReads = 0;
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
    await target.route(`${API}/v1/auth/logout`, (route) => route.fulfill({ status: 204 }));
    await target.route(`${API}/v1/me/volts`, (route) => {
      this.voltsReads += 1;

      return this.failVolts
        ? route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "x" } } })
        : route.fulfill({ json: { voltsBalance: this.balance } });
    });
    await target.route(`${API}/v1/me/inventory`, (route) =>
      route.fulfill({ json: this.inventory() }),
    );
    await target.route(`${API}/v1/shop/purchase`, (route) => this.purchase(route));
    await target.route(`${API}/v1/me/loadout`, (route) => this.loadoutRoute(route));
  }
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
