/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- Browser routes capture only the actual request at the HTTP boundary.
import { expect, test, type Page } from "@playwright/test";
import { z } from "../../../packages/shared/node_modules/zod/index.js";
import { openGameMenu } from "../e2e/helpers/gameMenu.js";
import {
  api,
  connectStrava,
  login,
  save,
  state,
  web,
} from "./ride-delivery-integration-runtime.spec.js";

async function onceAndState({ page }: { readonly page: Page }): Promise<void> {
  await page.goto(web);
  const session = await login(page);
  const before = (await state()).provider;
  const flow = await connectStrava(page);

  const confirmedAgain = await fetch(`${api}/v1/strava/confirm`, {
    method: "POST",
    headers: {
      Origin: web,
      Cookie: flow.cookie,
      Authorization: `Bearer ${session.sessionToken}`,
      "Content-Type": "application/json",
    },
    body: flow.confirmBody,
  });

  expect(confirmedAgain.status).toBe(401);
  const changed = new URL(flow.callbackUrl);

  changed.searchParams.set("state", "a".repeat(43));

  const changedState = await fetch(changed, {
    headers: { Cookie: flow.cookie },
    redirect: "manual",
  });

  const callbackAgain = await fetch(flow.callbackUrl, {
    headers: { Cookie: flow.cookie },
    redirect: "manual",
  });

  expect(changedState.status).toBe(401);
  expect(callbackAgain.status).toBe(401);
  expect((await state()).provider.tokenCalls).toBe(before.tokenCalls + 1);
  expect((await state()).provider.uploads).toHaveLength(before.uploads.length);
  await save(
    "binding-proof.json",
    JSON.stringify(
      {
        repeatedConfirmStatus: confirmedAgain.status,
        changedStateStatus: changedState.status,
        repeatedCallbackStatus: callbackAgain.status,
      },
      null,
      2,
    ),
  );
}

type HeldConfirm =
  | { readonly kind: "waiting" }
  | { readonly kind: "captured"; readonly body: string; readonly cookie: string };

function confirmObserved(
  sessionToken: string,
  request: { readonly cookie: string; readonly body: string },
): Promise<Response> {
  return fetch(`${api}/v1/strava/confirm`, {
    method: "POST",
    headers: {
      Origin: web,
      Cookie: request.cookie,
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: request.body,
  });
}

async function expiredHandoff({ page }: { readonly page: Page }): Promise<void> {
  await page.goto(web);
  const session = await login(page);
  const before = (await state()).provider;
  let held: HeldConfirm = { kind: "waiting" };

  await page.route(`${api}/v1/strava/confirm`, async (route) => {
    held = {
      kind: "captured",
      body: z.string().parse(route.request().postData()),
      cookie: z.string().parse((await route.request().allHeaders())["cookie"]),
    };
    await route.abort("failed");
  });
  await openGameMenu(page, "Strava");
  await page.getByRole("button", { name: "Mit Strava verbinden", exact: true }).click();
  await expect.poll(() => held.kind).toBe("captured");

  const request = z
    .object({ kind: z.literal("captured"), body: z.string(), cookie: z.string() })
    .parse(held);

  const started = performance.now();

  await page.waitForTimeout(65_000);

  const expired = await confirmObserved(session.sessionToken, request);

  expect(expired.status).toBe(401);
  expect(performance.now() - started).toBeGreaterThan(60_000);
  expect((await state()).provider.tokenCalls).toBe(before.tokenCalls + 1);
  expect((await state()).provider.uploads).toHaveLength(before.uploads.length);
  await save(
    "expiry-proof.json",
    JSON.stringify(
      {
        initialConfirm: "aborted-at-browser-network-boundary",
        realWaitMs: performance.now() - started,
        expiredConfirmStatus: expired.status,
        productClockModified: false,
      },
      null,
      2,
    ),
  );
}

export function registerBindingCases(): void {
  test(
    "binding actual callback and confirmation are one-use and reject changed OAuth state",
    onceAndState,
  );
  test(
    "expiry actual server rejects original handoff after its unmodified real-time deadline",
    expiredHandoff,
  );
}
