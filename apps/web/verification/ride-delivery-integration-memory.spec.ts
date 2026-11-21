/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- The cookie countercase clears only this test context's actual native cookie.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { openGameMenu } from "../e2e/helpers/gameMenu.js";
import { assertNativeNoopener } from "./ride-delivery-integration-popup.spec.js";
import {
  api,
  command,
  login,
  observations,
  save,
  state,
  web,
} from "./ride-delivery-integration-runtime.spec.js";

function denyPersistence(): void {
  for (const storage of ["localStorage", "sessionStorage", "indexedDB"]) {
    Object.defineProperty(window, storage, {
      configurable: true,
      get() {
        throw new DOMException("Injected persistence failure, cookies unchanged", "SecurityError");
      },
    });
  }
}

async function heldFlow(page: Page, context: BrowserContext) {
  await openGameMenu(page, "Strava");
  await command("hold");
  const before = (await state()).provider;
  const started = page.waitForResponse(`${api}/v1/strava/connect-start`);
  const popup = context.waitForEvent("page");

  await page.getByRole("button", { name: "Mit Strava verbinden", exact: true }).click();
  const child = await popup;

  expect((await started).status()).toBe(200);
  await expect
    .poll(async () => (await state()).provider.authorizeCount)
    .toBe(before.authorizeCount + 1);
  expect(child.isClosed()).toBe(false);
  await assertNativeNoopener(web);

  const cookie = (await context.cookies(`${api}/v1/strava/callback`)).find(
    (entry) => entry.name === "voltonaut-strava",
  );

  assert.ok(cookie);
  expect(cookie.httpOnly).toBe(true);

  return { before, cookie };
}

async function releaseFlow(
  page: Page,
  context: BrowserContext,
  missing: boolean,
  cookie: { readonly name: string; readonly value: string },
): Promise<number> {
  if (missing) await context.clearCookies({ name: cookie.name });

  const callback = context.waitForEvent(
    "response",
    (response) => new URL(response.url()).pathname === "/v1/strava/callback",
  );

  const confirmed = missing ? undefined : page.waitForResponse(`${api}/v1/strava/confirm`);

  await command("release");
  const result = await callback;

  expect(result.status()).toBe(missing ? 401 : 302);
  const callbackCookie = (await result.request().allHeaders())["cookie"] ?? "";

  expect(callbackCookie.includes(`${cookie.name}=${cookie.value}`)).toBe(!missing);

  if (confirmed !== undefined) {
    const response = await confirmed;

    expect(response.status()).toBe(200);
    expect((await response.request().allHeaders())["cookie"]).toContain(
      `${cookie.name}=${cookie.value}`,
    );
    await expect(page.locator("#strava-panel")).toContainText("Mit Strava verbunden");
  }

  return result.status();
}

export async function memoryCookieFlow(
  page: Page,
  context: BrowserContext,
  missing: boolean,
): Promise<void> {
  await context.addInitScript(denyPersistence);
  await page.goto(web);
  const session = await login(page);

  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    "Nur in diesem Tab",
  );
  const originalUrl = page.url();
  const { before, cookie } = await heldFlow(page, context);
  const confirmation = missing ? null : page.waitForRequest(`${api}/v1/strava/confirm`);
  const status = await releaseFlow(page, context, missing, cookie);

  if (confirmation !== null)
    expect((await (await confirmation).allHeaders())["authorization"]).toBe(
      `Bearer ${session.sessionToken}`,
    );
  expect(page.url()).toBe(originalUrl);

  const me = await fetch(`${api}/v1/me`, {
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });

  expect(me.status).toBe(200);
  const after = (await state()).provider;

  expect(after.tokenCalls).toBe(before.tokenCalls + (missing ? 0 : 1));
  expect(after.uploads).toHaveLength(before.uploads.length);

  if (missing)
    expect(
      observations.requests.filter((request) => request.path === "/v1/strava/confirm"),
    ).toEqual([]);
  await saveCookieProof({ missing, cookie, status, bearerValid: me.status === 200 });
}

async function saveCookieProof(evidence: {
  readonly missing: boolean;
  readonly cookie: { readonly httpOnly: boolean; readonly value: string };
  readonly status: number;
  readonly bearerValid: boolean;
}): Promise<void> {
  await save(
    "cookie-proof.json",
    JSON.stringify(
      {
        mode: "injected-persistence-failure-cookies-unchanged",
        deliberatelyClearedCookie: evidence.missing,
        httpOnly: evidence.cookie.httpOnly,
        originalCookieSha256: createHash("sha256").update(evidence.cookie.value).digest("hex"),
        callbackStatus: evidence.status,
        originalMemoryBearerStillValid: evidence.bearerValid,
      },
      null,
      2,
    ),
  );
}
