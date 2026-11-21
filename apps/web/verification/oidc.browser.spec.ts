import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SessionResponseSchema, type SessionResponse } from "@voltonaut/shared";
import { closeGameMenu, openGameMenu } from "../e2e/helpers/gameMenu.js";

const webOrigin = process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5187";
const api = process.env["API_ORIGIN"] ?? "";
const artifacts = process.env["AUTH_ARTIFACTS"] ?? "";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page contract and its mutable browser handles.
async function assertWorld(page: Readonly<Page>): Promise<void> {
  await closeGameMenu(page);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const diagnostics = page.getByLabel("Render diagnostics");
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-calls")))
    .toBeGreaterThan(0);
  const distance = Number(await diagnostics.getAttribute("data-distance-m"));
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
    .toBeGreaterThan(distance + 10);
  await page
    .getByRole("region", { name: "Ride world", exact: true })
    .screenshot({ path: join(artifacts, "guest-world.png") });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page contract and network response handles.
async function signedLogin(page: Readonly<Page>): Promise<SessionResponse> {
  await openGameMenu(page, "Konto");
  const exchange = page.waitForResponse(`${api}/v1/auth/oidc/exchange`);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  const response = await exchange;
  assert.equal(response.status(), 200);
  const raw: unknown = await response.json();
  const session = SessionResponseSchema.parse(raw);
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    `Angemeldet als ${session.user.email}`,
  );
  assert.equal(page.url(), `${webOrigin}/`);
  assert.equal((await page.content()).includes(session.sessionToken), false);
  await page
    .getByRole("region", { name: "Konto", exact: true })
    .screenshot({ path: join(artifacts, "signed-account.png") });

  return session;
}

async function verifiedLogout(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns native Page handles.
  page: Readonly<Page>,
  session: Readonly<SessionResponse>,
): Promise<void> {
  await openGameMenu(page, "Konto");
  const response = page.waitForResponse(`${api}/v1/auth/logout`);
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  assert.equal((await response).status(), 204);
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    /abgemeldet/iu,
  );

  const me = await fetch(`${api}/v1/me`, {
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });

  assert.equal(me.status, 401);
  await page.reload();
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page and Request event contracts.
function trackRequests(page: Readonly<Page>, origin: string): string[] {
  const requests: string[] = [];
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Browser network events provide native Playwright Request handles.
  page.on("request", (request) => {
    if (request.url().startsWith(origin)) requests.push(request.url());
  });

  return requests;
}

function denyStorage(): void {
  for (const name of ["localStorage", "indexedDB"]) {
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns native Page and Dialog handles.
async function confirmNavigation(page: Readonly<Page>, accept: boolean): Promise<void> {
  await openGameMenu(page, "Konto");
  const dialog = page.waitForEvent("dialog");
  const click = page.getByRole("button", { name: "Anmelden", exact: true }).click();
  const prompt = await dialog;
  assert.equal(prompt.type(), "beforeunload");

  if (accept) await prompt.accept();
  else await prompt.dismiss();
  await click;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns fixture handles.
test("online signed login, reload restore and real revocation", async ({ page }) => {
  const authRequests = trackRequests(page, `${api}/v1/`);
  const messages: string[] = [];
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Browser emits native Playwright console handles.
  page.on("console", (message) => {
    messages.push(message.text());
  });
  await page.goto(`${webOrigin}/?sim=1&debug=1`);
  await assertWorld(page);
  assert.deepEqual(authRequests, []);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await assertWorld(page);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
  const session = await signedLogin(page);
  await openGameMenu(page, "Aufnahmen");
  await expect(page.getByRole("button", { name: "TCX herunterladen" })).toHaveCount(1);
  const me = page.waitForResponse(`${api}/v1/me`);
  await page.reload();
  assert.equal((await me).status(), 200);
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    session.user.email,
  );
  await verifiedLogout(page, session);
  assert.equal(messages.join("\n").includes(session.sessionToken), false);
  assert.equal(messages.join("\n").includes("provider-access-private"), false);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns fixture handles.
test("online memory session with completely denied browser storage", async ({ page, context }) => {
  await context.addInitScript(denyStorage);
  await page.goto(`${webOrigin}/?sim=1&debug=1`);
  await assertWorld(page);
  await openGameMenu(page, "Profil");
  await expect(page.getByTestId("profile-status")).toContainText("Local storage unavailable");
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-status")).toHaveText("Save failed");
  const session = await signedLogin(page);
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    "Nur in diesem Tab",
  );
  await verifiedLogout(page, session);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns fixture handles.
test("online invalid or unbound handoff is scrubbed and never automatically retried", async ({
  page,
}) => {
  const requests = trackRequests(page, `${api}/v1/`);
  await page.goto(`${webOrigin}/auth/finish?code=bad#private`);
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    "Ungültige Anmeldung",
  );
  assert.equal(page.url(), `${webOrigin}/`);
  assert.deepEqual(requests, []);
  const exchange = page.waitForResponse(`${api}/v1/auth/oidc/exchange`);
  await page.goto(`${webOrigin}/auth/finish?code=${"a".repeat(43)}`);
  assert.equal((await exchange).status(), 401);
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    "Anmeldung fehlgeschlagen",
  );
  assert.equal(page.url(), `${webOrigin}/`);
  assert.deepEqual(requests, [`${api}/v1/auth/oidc/exchange`]);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns fixture handles.
test("online unsaved recording guards cancellation and continuation; exported TCX allows login", async ({
  page,
  context,
}) => {
  await context.addInitScript(denyStorage);
  await page.goto(`${webOrigin}/?sim=1&debug=1`);
  await assertWorld(page);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await confirmNavigation(page, false);
  await openGameMenu(page, "Aufnahmen");
  await expect(page.getByTestId("recording-status")).toContainText("Aufnahme läuft");
  await assertWorld(page);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Aufnahme bleibt in diesem Tab");
  await confirmNavigation(page, false);
  await openGameMenu(page, "Aufnahmen");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "TCX herunterladen" }).click();
  const path = join(artifacts, "blocked-storage-sim.tcx");
  await (await download).saveAs(path);
  assert.match(await readFile(path, "utf8"), /TrainingCenterDatabase/u);
  const session = await signedLogin(page);
  await verifiedLogout(page, session);
  await page.goto(`${webOrigin}/?sim=1`);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  const exchange = page.waitForResponse(`${api}/v1/auth/oidc/exchange`);
  await confirmNavigation(page, true);
  assert.equal((await exchange).status(), 200);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns fixture handles.
test("offline backend and denied storage still render and record", async ({ page, context }) => {
  await context.addInitScript(denyStorage);
  const requests = trackRequests(page, api);
  await page.goto(`${webOrigin}/?sim=1&debug=1`);
  await assertWorld(page);
  assert.deepEqual(requests, []);
  await openGameMenu(page, "Konto");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    "nicht erreichbar",
  );
  await assertWorld(page);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await assertWorld(page);
  await openGameMenu(page, "Aufnahmen");
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Aufnahme bleibt in diesem Tab");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "TCX herunterladen" }).click();
  await (await download).saveAs(join(artifacts, "offline-sim.tcx"));
});
