/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- Account transitions use actual browser lifecycle and public HTTP handles.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { z } from "../../../packages/shared/node_modules/zod/index.js";
import { openGameMenu } from "../e2e/helpers/gameMenu.js";
import {
  api,
  command,
  connectStrava,
  login,
  observations,
  selectRide,
  state,
  web,
} from "./ride-delivery-integration-runtime.spec.js";
import { capture, claim, prepare } from "./ride-delivery-integration-capture.spec.js";

async function logout(page: Page): Promise<void> {
  await openGameMenu(page, "Konto");
  const loggedOut = page.waitForResponse(`${api}/v1/auth/logout`);

  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  expect((await loggedOut).status()).toBe(204);
}

async function cookieHeader(context: BrowserContext): Promise<string> {
  return (await context.cookies(`${api}/v1/strava/confirm`))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function postOwned(
  context: BrowserContext,
  sessionToken: string,
  path: string,
  body: string,
): Promise<Response> {
  return fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Origin: web,
      Cookie: await cookieHeader(context),
      "Content-Type": "application/json",
    },
    body,
  });
}

async function accountSwitch({
  page,
  context,
}: {
  readonly page: Page;
  readonly context: BrowserContext;
}): Promise<void> {
  const a = await prepare(page);
  const recording = await capture(page, "ble");

  await claim(page, recording);
  await connectStrava(page);

  const offer = z
    .object({ kind: z.literal("offer"), consent: z.unknown() })
    .parse(JSON.parse(await selectRide(page, recording)));

  const before = (await state()).provider.uploads.length;

  const missing = await postOwned(
    context,
    a.sessionToken,
    `/v1/strava/rides/${recording.rideId}`,
    JSON.stringify({ action: "upload" }),
  );

  expect(missing.status).toBe(422);
  await logout(page);
  await command("identity");
  const b = await login(page);

  const stale = await postOwned(
    context,
    b.sessionToken,
    `/v1/strava/rides/${recording.rideId}`,
    JSON.stringify({ action: "upload", consent: offer.consent }),
  );

  expect(stale.status).toBe(404);

  const foreign = await fetch(`${api}/v2/rides/${recording.rideId}`, {
    headers: { Authorization: `Bearer ${b.sessionToken}` },
  });

  expect(foreign.status).toBe(404);
  await assertEmptyHistory(page);
  expect((await state()).provider.uploads).toHaveLength(before);
}

async function assertEmptyHistory(page: Page): Promise<void> {
  await openGameMenu(page, "Strava");
  await page.getByRole("button", { name: "Eigene Kontofahrten laden", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Strava-Vorschau /u })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Diese Fahrt einmalig an Strava senden", exact: true }),
  ).toHaveCount(0);
}

function accountCode(): void {
  test("account-switch-code actual A popup handoff cannot confirm with B original browser cookie", async ({
    page,
    context,
  }) => {
    await page.goto(web);
    await login(page);
    await openGameMenu(page, "Strava");
    await command("hold");
    const before = (await state()).provider;
    const popup = context.waitForEvent("page");

    await page.getByRole("button", { name: "Mit Strava verbinden", exact: true }).click();
    const child = await popup;

    await expect
      .poll(async () => (await state()).provider.authorizeCount)
      .toBe(before.authorizeCount + 1);
    await logout(page);
    await command("identity");
    const b = await login(page);

    const callback = child.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/strava/callback",
    );

    await command("release");
    const returned = await callback;

    expect(returned.status()).toBe(302);
    const location = z.string().parse(returned.headers()["location"]);
    const code = z.string().min(1).parse(new URL(location).searchParams.get("code"));

    const denied = await postOwned(
      context,
      b.sessionToken,
      "/v1/strava/confirm",
      JSON.stringify({ code }),
    );

    expect(denied.status).toBe(401);
    await openGameMenu(page, "Strava");
    await expect(page.locator("#strava-panel")).toContainText("Nicht mit Strava verbunden");
    expect(
      observations.requests.filter((request) => request.path === "/v1/strava/confirm"),
    ).toEqual([]);
    expect((await state()).provider.uploads).toHaveLength(before.uploads.length);
  });
}

export function registerAccountCases(): void {
  test(
    "account-switch stale actual A offer cannot upload under B and missing consent fails closed",
    accountSwitch,
  );
  accountCode();
}
