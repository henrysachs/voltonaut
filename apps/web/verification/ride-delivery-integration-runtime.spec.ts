/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable native browser, request and fixture handles.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  SessionResponseSchema,
  StravaProgressSchema,
  type StravaProgress,
  type RecordingV2,
  type SessionResponse,
} from "@voltonaut/shared";
import { z } from "../../../packages/shared/node_modules/zod/index.js";
import { nativeControlFakeScript } from "../e2e/helpers/nativeControl.js";
import { openGameMenu } from "../e2e/helpers/gameMenu.js";
import {
  assertNativeNoopener,
  observePopups,
  popupObservations,
} from "./ride-delivery-integration-popup.spec.js";

export const web = z.string().url().parse(process.env["WEB_ORIGIN"]);
export const api = z.string().url().parse(process.env["API_ORIGIN"]);
export const artifacts = z.string().min(1).parse(process.env["DELIVERY_ARTIFACTS"]);

export const expectedWorkers = z
  .array(z.string())
  .parse(JSON.parse(process.env["DELIVERY_WORKERS"] ?? "[]"));

const control = z.string().url().parse(process.env["DELIVERY_CONTROL"]);

const origins = z
  .array(z.string().url())
  .parse(JSON.parse(process.env["DELIVERY_ORIGINS"] ?? "[]"));

const ObservedProgressSchema = z
  .unknown()
  .transform((value): StravaProgress => StravaProgressSchema.parse(value));

const StateSchema = z.object({
  provider: z.object({
    uploads: z.array(
      z.object({
        id: z.string(),
        tcx: z.string(),
        filename: z.string(),
        fields: z.record(z.string()),
        response: z.string(),
      }),
    ),
    polls: z.array(z.object({ id: z.string(), mode: z.string() })),
    authorizeCount: z.number(),
    tokenCalls: z.number(),
    faults: z.array(z.string()),
  }),
  deliveries: z.array(
    z.object({
      rideId: z.string(),
      userId: z.string(),
      progress: ObservedProgressSchema,
    }),
  ),
});

let name = "";

type Observations = {
  requests: {
    readonly origin: string;
    readonly path: string;
    readonly method: string;
    readonly status: number;
  }[];
  workers: string[];
  blocked: string[];
  errors: string[];
};

export const observations: Observations = { requests: [], workers: [], blocked: [], errors: [] };

export async function command(path: string): Promise<void> {
  const response = await fetch(`${control}/${path}`, { method: "POST" });

  assert.equal(response.status, 204, await response.text());
}

export async function state() {
  const response = await fetch(`${control}/state`);

  assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
  const raw: unknown = await response.json();

  return StateSchema.parse(raw);
}

export async function save(suffix: string, value: string): Promise<void> {
  await writeFile(join(artifacts, `${name}-${suffix}`), value);
}

test.beforeEach(async ({ context }, info) => {
  name = info.title.replaceAll(/[^a-z0-9-]/giu, "-");
  observations.requests = [];
  observations.workers = [];
  observations.blocked = [];
  observations.errors = [];
  await command("identity");
  await context.addInitScript({ content: nativeControlFakeScript() });
  await observePopups(context);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    if (
      !origins.includes(url.origin) ||
      /(?:\.(?:ts|tsx)$|^\/(?:@|src\/|node_modules\/))/u.test(url.pathname)
    ) {
      observations.blocked.push(`${url.origin}${url.pathname}`);
      await route.abort();

      return;
    }

    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    observations.blocked.push(socket.url());
    void socket.close();
  });
  context.on("page", (page) => {
    page.on("worker", (worker) => {
      observations.workers.push(new URL(worker.url()).pathname);
    });
    page.on("pageerror", (error) => {
      observations.errors.push(error.message);
    });
  });
  context.on("response", (response) => {
    const url = new URL(response.url());

    observations.requests.push({
      origin: url.origin,
      path: url.pathname,
      method: response.request().method(),
      status: response.status(),
    });
  });
});

test.afterEach(async ({ page }, info) => {
  await page
    .screenshot({
      path: join(artifacts, `${name}-${info.status ?? "unknown"}.png`),
      fullPage: true,
    })
    .catch(() => null);
  await save(
    "network.json",
    JSON.stringify({ ...observations, nativePopups: popupObservations }, null, 2),
  );
  await save("state.json", JSON.stringify(await state(), null, 2));
  expect(observations.blocked).toEqual([]);
  expect(observations.errors).toEqual([]);
  expect(observations.requests.filter((request) => request.status === 429)).toEqual([]);
  expect(popupObservations.every((entry) => entry.noopener)).toBe(true);
});

export async function login(page: Page): Promise<SessionResponse> {
  await openGameMenu(page, "Konto");
  const exchange = page.waitForResponse(`${api}/v1/auth/oidc/exchange`);

  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  const response = await exchange;

  expect(response.status()).toBe(200);
  const raw: unknown = await response.json();
  const session = SessionResponseSchema.parse(raw);

  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    session.user.email,
  );
  expect(await page.content()).not.toContain(session.sessionToken);

  return session;
}

export async function connectStrava(page: Page): Promise<{
  readonly confirmBody: string;
  readonly cookie: string;
  readonly callbackUrl: string;
}> {
  const before = (await state()).provider;

  await openGameMenu(page, "Strava");
  await expect(
    page.getByRole("button", { name: "Mit Strava verbinden", exact: true }),
  ).toBeVisible();
  const popup = page.context().waitForEvent("page");

  const callback = page
    .context()
    .waitForEvent(
      "response",
      (response) => new URL(response.url()).pathname === "/v1/strava/callback",
    );

  const confirmed = page.waitForResponse(`${api}/v1/strava/confirm`);

  await page.getByRole("button", { name: "Mit Strava verbinden", exact: true }).click();
  await popup;
  await assertNativeNoopener(web);
  const response = await confirmed;

  expect(response.status()).toBe(200);
  await expect(page.locator("#strava-panel")).toContainText("Mit Strava verbunden");
  expect((await state()).provider.tokenCalls).toBe(before.tokenCalls + 1);
  expect((await state()).provider.uploads).toHaveLength(before.uploads.length);

  return {
    confirmBody: z.string().parse(response.request().postData()),
    cookie: z.string().parse((await response.request().allHeaders())["cookie"]),
    callbackUrl: (await callback).request().url(),
  };
}

export async function selectRide(page: Page, recording: RecordingV2): Promise<string> {
  await openGameMenu(page, "Strava");
  await page.getByRole("button", { name: "Eigene Kontofahrten laden", exact: true }).click();
  const preview = page.waitForResponse(`${api}/v1/strava/rides/${recording.rideId}`);

  await page.getByRole("button", { name: /^Strava-Vorschau /u }).click();
  const response = await preview;

  expect(response.status()).toBe(200);

  return response.text();
}

export async function send(page: Page, recording: RecordingV2): Promise<void> {
  await selectRide(page, recording);

  const button = page.getByRole("button", {
    name: "Diese Fahrt einmalig an Strava senden",
    exact: true,
  });

  await expect(button).toBeDisabled();
  const before = (await state()).provider.uploads.length;

  await page.getByRole("checkbox", { name: /Ich willige ausdrücklich/u }).check();

  const accepted = page.waitForResponse(
    (response) =>
      response.url() === `${api}/v1/strava/rides/${recording.rideId}` &&
      response.request().method() === "POST",
  );

  await button.click();
  expect((await accepted).ok()).toBe(true);
  await expect.poll(async () => (await state()).provider.uploads.length).toBe(before + 1);
  const upload = (await state()).provider.uploads.at(-1);

  assert.ok(upload);
  expect(upload.fields).toMatchObject({
    data_type: "tcx",
    sport_type: "VirtualRide",
    trainer: "1",
    visibility: "only_me",
    external_id: `voltonaut-${recording.rideId}.tcx`,
  });
  expect(upload.tcx).toContain("TrainingCenterDatabase");
  expect(upload.tcx).not.toContain("<Position>");
}

export async function progress(rideId: string): Promise<string | undefined> {
  return (await state()).deliveries.find((row) => row.rideId === rideId)?.progress.kind;
}
