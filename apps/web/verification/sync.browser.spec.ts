import assert from "node:assert/strict";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_RIDER_PROFILE, RideListSchema, SessionResponseSchema } from "@voltonaut/shared";
import { openGameMenu } from "../e2e/helpers/gameMenu.js";

const web = process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5193";
const api = process.env["API_ORIGIN"] ?? "";
const control = process.env["SYNC_CONTROL"] ?? "";
const artifacts = process.env["AUTH_ARTIFACTS"] ?? "";

async function command(path: string): Promise<void> {
  assert.equal((await fetch(`${control}/${path}`, { method: "POST" })).status, 204);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page lifecycle handle.
async function login(page: Readonly<Page>, identity: "a" | "b") {
  await command(identity);
  await openGameMenu(page, "Konto");
  const exchange = page.waitForResponse(`${api}/v1/auth/oidc/exchange`);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  const response = await exchange;
  assert.equal(response.status(), 200);
  const raw: unknown = await response.json();
  const session = SessionResponseSchema.parse(raw);
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    `sync-${identity}@example.com`,
  );
  expect(await page.content()).not.toContain(session.sessionToken);

  return session;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page and native dialog handles.
async function confirm(page: Readonly<Page>, label: string): Promise<void> {
  await openGameMenu(page, "Konto");
  const dialog = page.waitForEvent("dialog");
  const click = page.getByRole("button", { name: label, exact: true }).click();
  await (await dialog).accept();
  await click;
}

async function archive() {
  const { openRideDatabase } = await import("../src/sync/rideDatabase.js");

  return (await openRideDatabase(indexedDB)).list();
}

async function localProfileName() {
  const { openProfileDatabase } = await import("../src/sync/profile-database.js");

  return (await (await openProfileDatabase(indexedDB)).loadRecord())?.profile.displayName;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page lifecycle handle.
async function record(page: Readonly<Page>) {
  await page.goto(`${web}/?sim=1&debug=1`);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const before = await page.evaluate(archive);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
  const after = await page.evaluate(archive);
  const ride = after.find((entry) => !before.some((old) => old.rideId === entry.rideId));
  assert.ok(ride);

  return ride;
}

async function claim(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns native Page/Locator handles.
  page: Readonly<Page>,
  rideId: string,
  email = "sync-a@example.com",
): Promise<void> {
  await openGameMenu(page, "Konto");
  await page
    .getByRole("button", { name: "Kontodaten und lokales Archiv aktualisieren", exact: true })
    .click();
  const item = page.locator(`[data-local-ride-id="${rideId}"]`);
  const dialog = page.waitForEvent("dialog");
  const click = item.getByRole("button").click();
  const prompt = await dialog;
  expect(prompt.message()).toContain(email);
  await prompt.accept();
  await click;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page lifecycle handle.
async function profileFlow(page: Readonly<Page>): Promise<void> {
  await openGameMenu(page, "Profil");
  await page.getByTestId("profile-displayName").fill("Sync A");
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-status")).toHaveText("Saved locally");
  await page.getByTestId("profile-displayName").fill("Unsaved draft");
  await confirm(page, "Zuletzt lokal gespeichertes Profil ins Konto übernehmen");
  await expect(page.locator('[data-outbox-id="profile"]')).toContainText("Auf Server gespeichert");
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Serverprofil: Sync A",
  );
  await openGameMenu(page, "Profil");
  await expect(page.getByTestId("profile-displayName")).toHaveValue("Unsaved draft");
  await page.getByTestId("profile-displayName").fill("Frozen next");
  await page.getByTestId("profile-save").click();
  await expect.poll(() => page.evaluate(localProfileName)).toBe("Frozen next");
  await page.goto(`${web}/?sim=1&debug=1`);
  await openGameMenu(page, "Profil");
  await expect(page.getByTestId("profile-displayName")).toHaveValue("Frozen next");
  await confirm(page, "Serverprofil für nächste Fahrt lokal verwenden");
  await openGameMenu(page, "Profil");
  await expect(page.getByTestId("profile-displayName")).toHaveValue("Sync A");
  await expect(page.getByTestId("profile-status")).toContainText("nächste Fahrt");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page lifecycle handle.
async function offlineAndSwitch(page: Readonly<Page>, rideId: string): Promise<void> {
  await command("offline");
  await claim(page, rideId);
  await expect(page.locator(`[data-outbox-id="${rideId}"]`)).toContainText("Dauerhaft vorgemerkt");
  await page.reload();
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).not.toContainText(
    "Sync A",
  );
  await command("online");
  await login(page, "b");
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Noch kein Serverprofil vorhanden",
  );
  await expect(
    page.getByRole("region", { name: "Serverfahrten dieses Kontos", exact: true }),
  ).toContainText("Noch keine Serverfahrten");
  await expect(
    page.getByRole("region", { name: "Kontowarteschlange", exact: true }),
  ).not.toContainText(rideId);
  await page.getByRole("button", { name: "Vorgemerkte Aufträge erneut versuchen" }).click();
  await expect(
    page.getByRole("region", { name: "Kontowarteschlange", exact: true }),
  ).not.toContainText(rideId);
  await claim(page, rideId, "sync-b@example.com");
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "bereits einem anderen Konto zugeordnet",
  );
  const logout = page.waitForResponse(`${api}/v1/auth/logout`);
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  expect((await logout).status()).toBe(204);
  await login(page, "a");
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Vorgemerkte Aufträge erneut versuchen" }).click();
  await expect(page.locator(`[data-outbox-id="${rideId}"]`)).toContainText(
    "Auf Server gespeichert",
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page and route lifecycle handles.
async function lostResponse(page: Readonly<Page>, rideId: string): Promise<void> {
  let committed = false;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright supplies a native Route; only data responses, never auth, are interrupted.
  await page.route(`${api}/v1/rides`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();

      return;
    }

    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed = true;
    await route.abort("failed");
  });
  await claim(page, rideId);
  await expect.poll(() => committed).toBe(true);
  await expect(page.locator(`[data-outbox-id="${rideId}"]`)).toContainText("Dauerhaft vorgemerkt");
  await page.unroute(`${api}/v1/rides`);
  await command("restart");
  await page.reload();
  await openGameMenu(page, "Konto");
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Vorgemerkte Aufträge erneut versuchen" }).click();
  await expect(page.locator(`[data-outbox-id="${rideId}"]`)).toContainText(
    "Auf Server gespeichert",
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns browser fixture handles.
test("sync signed two-account profile, explicit archive claim, offline reload and lost-response restart", async ({
  page,
}) => {
  const first = await record(page);
  const a = await login(page, "a");
  await expect(
    page.getByRole("region", { name: "Serverfahrten dieses Kontos", exact: true }),
  ).toContainText("Noch keine Serverfahrten");
  await claim(page, first.rideId);
  await expect(page.locator(`[data-outbox-id="${first.rideId}"]`)).toContainText(
    "Auf Server gespeichert",
  );
  await profileFlow(page);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
  const second = (await page.evaluate(archive)).find((ride) => ride.rideId !== first.rideId);
  assert.ok(second);
  expect(second.metadata.profile.displayName).toBe("Frozen next");
  await offlineAndSwitch(page, second.rideId);
  const third = await record(page);
  await lostResponse(page, third.rideId);

  const response = await fetch(`${api}/v1/rides`, {
    headers: { Authorization: `Bearer ${a.sessionToken}` },
  });

  expect(response.status).toBe(200);
  const raw: unknown = await response.json();
  expect(
    RideListSchema.parse(raw)
      .rides.map((ride) => ride.rideId)
      .toSorted(),
  ).toEqual([first.rideId, second.rideId, third.rideId].toSorted());
  await page
    .getByRole("region", { name: "Kontodaten", exact: true })
    .screenshot({ path: join(artifacts, "account-data.png") });
});

function denyStorage(): void {
  for (const name of ["indexedDB", "localStorage"]) {
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns browser/context fixture handles.
test("sync signed profile pull fails closed with denied storage and keeps the local form", async ({
  page,
  context,
}) => {
  await context.addInitScript(denyStorage);
  await page.goto(`${web}/?sim=1&debug=1`);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const session = await login(page, "a");

  const response = await fetch(`${api}/v1/me/profile`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...DEFAULT_RIDER_PROFILE, displayName: "Remote denied" }),
  });

  expect(response.status).toBe(200);
  await page
    .getByRole("button", { name: "Kontodaten und lokales Archiv aktualisieren", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Serverprofil: Remote denied",
  );
  await expect(
    page.getByRole("button", {
      name: "Serverprofil für nächste Fahrt lokal verwenden",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Kontowarteschlange nicht bestätigt",
  );
  await openGameMenu(page, "Profil");
  await expect(page.getByTestId("profile-displayName")).toHaveValue(
    DEFAULT_RIDER_PROFILE.displayName,
  );
  await expect(page.getByTestId("profile-status")).toContainText("Local storage unavailable");
  await confirm(page, "Zuletzt lokal gespeichertes Profil ins Konto übernehmen");
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Lokales Profil nicht lesbar. Nicht vorgemerkt.",
  );
});
