/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser pages, contexts and routes. */
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";

import { openGameMenu } from "./helpers/gameMenu.js";
import { LoadoutServer } from "./helpers/loadoutServer.js";
import { riderShown } from "./helpers/rideWorld.js";
import { previewWorkerPrelude } from "./render-worker.helpers.js";

async function openGarage(page: Page, url = "/?sim=1&debug=1"): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Garage / Shop");
}

function lookOf(page: Page) {
  return page.getByLabel("Render diagnostics");
}

/** Ridden distance from the diagnostics; waits for the first frame instead of reading 0 m. */
async function distanceOf(page: Page): Promise<number> {
  await expect(lookOf(page)).toHaveAttribute("data-distance-m", /^\d/u);

  return Number(await lookOf(page).getAttribute("data-distance-m"));
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

  const distanceM = await distanceOf(page);

  await page.getByTestId("garage-equip").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Ausgerüstet");
  await expect(page.getByTestId("garage-equip")).toHaveText("Ausgerüstet");
  // The disabled „Ausrüsten“ hands focus to the hint instead of dropping it to the page.
  await expect(page.getByTestId("garage-equip-hint")).toBeFocused();
  expect(server.loadout.rider.jerseyId).toBe("jersey.stripe");
  await riderShown(page);
  await expect(lookOf(page)).toHaveAttribute("data-look", /"jerseyId":"jersey\.stripe"/u);
  await expect.poll(() => distanceOf(page)).toBeGreaterThan(distanceM);

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
  await riderShown(other);
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

  // Another device changed the equipment meanwhile; the rejection must show that server state.
  server.loadout = {
    ...DEFAULT_AVATAR_CONFIG,
    rider: { ...DEFAULT_AVATAR_CONFIG.rider, helmetColor: "#ec6b48" },
  };
  await page.getByTestId("garage-equip").click();
  await expect(page.getByTestId("garage-equip-hint")).toContainText("Ausrüsten abgelehnt");
  await expect(page.getByTestId("garage-item-status-jersey.classic")).toHaveText("Ausgerüstet");
  await riderShown(page);
  await expect(lookOf(page)).toHaveAttribute("data-look", /"helmetColor":"#ec6b48"/u);
  expect(server.loadoutRequests).toEqual(["GET", "PUT", "GET"]);

  await page.getByTestId("garage-item-jersey.stripe").click();
  await page.getByTestId("garage-discard").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("garage-item-name")).toHaveText("Voltonaut Classic");
  await expect(page.getByTestId("garage-discard")).toBeHidden();
  await expect(page.getByTestId("garage-equip-hint")).toBeFocused();
  expect(server.loadoutRequests).toEqual(["GET", "PUT", "GET"]);
});

test("a failing shop read retries only when the rider selects something", async ({ page }) => {
  const server = new LoadoutServer();

  server.failVolts = true;
  await server.attach(page);
  await openGarage(page);
  await expect(page.getByTestId("garage-purchase-hint")).toContainText("Shop nicht erreichbar");

  const readsAfterStart = server.voltsReads;

  // Idle with the menu open: no request storm from renders that follow the failed reads.
  await expect.poll(() => distanceOf(page), { timeout: 10_000 }).toBeGreaterThan(5);
  expect(server.voltsReads).toBe(readsAfterStart);

  await page.getByTestId("garage-item-jersey.stripe").click();
  await expect(page.getByTestId("garage-purchase-hint")).toContainText("Shop nicht erreichbar");
  await expect.poll(() => distanceOf(page)).toBeGreaterThan(10);
  expect(server.voltsReads).toBe(readsAfterStart + 1);
});

test("logging out returns the garage to the default equipment", async ({ page }) => {
  const server = new LoadoutServer();

  server.owned = ["jersey.stripe"];
  server.loadout = {
    ...DEFAULT_AVATAR_CONFIG,
    rider: { ...DEFAULT_AVATAR_CONFIG.rider, jerseyId: "jersey.stripe" },
  };
  await server.attach(page);
  await openGarage(page);
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Ausgerüstet");

  await openGameMenu(page, "Konto");
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await openGameMenu(page, "Garage / Shop");
  await expect(page.getByTestId("garage-item-status-jersey.classic")).toHaveText("Ausgerüstet");
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).not.toHaveText("Ausgerüstet");
  await riderShown(page);
  await expect(lookOf(page)).toHaveAttribute("data-look", /"jerseyId":"jersey\.classic"/u);
});

test("a double-clicked purchase confirmation buys once and equips nothing", async ({ page }) => {
  const server = new LoadoutServer();

  await server.attach(page);
  await openGarage(page, "/?sim=1");
  await page.getByTestId("garage-item-jersey.stripe").click();
  await page.getByTestId("garage-purchase").click();
  await page.getByTestId("garage-purchase-confirm").dblclick();
  await expect(page.getByTestId("garage-item-status-jersey.stripe")).toHaveText("Im Besitz");

  // A fast server answers before the second click; that click then reaches „Ausrüsten“.
  await page.getByTestId("garage-equip").dispatchEvent("click", { detail: 2 });
  await expect(page.getByTestId("garage-equip")).toHaveText("Ausrüsten");

  expect(server.owned).toEqual(["jersey.stripe"]);
  expect(server.loadout).toEqual(DEFAULT_AVATAR_CONFIG);
  expect(server.loadoutRequests).toEqual(["GET"]);
});

test("equipping works without WebGL and a guest sends no loadout request", async ({
  page,
  browser,
}) => {
  const server = new LoadoutServer();

  server.owned = ["jersey.stripe"];
  await server.attach(page);
  await previewWorkerPrelude(page, "OffscreenCanvas.prototype.getContext = () => null;");
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
