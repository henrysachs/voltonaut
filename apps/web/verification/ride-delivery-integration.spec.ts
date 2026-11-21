/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns mutable fixture handles.
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { z } from "../../../packages/shared/node_modules/zod/index.js";
import { closeGameMenu } from "../e2e/helpers/gameMenu.js";
import {
  artifacts,
  command,
  connectStrava,
  expectedWorkers,
  login,
  observations,
  progress,
  selectRide,
  send,
  state,
  web,
} from "./ride-delivery-integration-runtime.spec.js";
import { capture, claim, prepare, readArchive } from "./ride-delivery-integration-capture.spec.js";
import { memoryCookieFlow } from "./ride-delivery-integration-memory.spec.js";
import { registerAccountCases } from "./ride-delivery-integration-account.spec.js";
import { registerBindingCases } from "./ride-delivery-integration-binding.spec.js";

registerAccountCases();

registerBindingCases();

test("capture-owned real native-boundary ride is replayed and persists unchanged", async ({
  page,
}) => {
  await prepare(page);
  const recording = await capture(page, "ble");

  await claim(page, recording);
  const archive = await page.evaluate(readArchive);

  await closeGameMenu(page);
  await expect(page.getByLabel("3D ride scene")).toBeVisible();
  await page.getByLabel("3D ride scene").screenshot({ path: join(artifacts, "actual-world.png") });
  await page.reload();
  expect(await page.evaluate(readArchive)).toBe(archive);

  for (const worker of expectedWorkers) expect(observations.workers).toContain(worker);
  expect((await state()).provider.uploads).toHaveLength(0);
});

test("delivery explicit connect and consent require completed provider processing", async ({
  page,
}) => {
  await prepare(page);
  const recording = await capture(page, "ble");

  await claim(page, recording);
  await connectStrava(page);
  await send(page, recording);
  await expect.poll(() => progress(recording.rideId)).toBe("processing");
  await expect(page.locator("#strava-panel")).not.toContainText("Verarbeitung bestätigt");
  await command("mode/complete");
  await expect.poll(() => progress(recording.rideId), { timeout: 30_000 }).toBe("delivered");
  await page.getByRole("button", { name: "Strava-Status laden", exact: true }).click();
  await expect(page.locator("#strava-panel")).toContainText(
    "Verarbeitung bestätigt. Aktivität 9001",
  );
  expect((await state()).provider.polls.length).toBeGreaterThan(0);
});

test("lost-response accepted external POST survives API restart and reload without resend", async ({
  page,
}) => {
  await prepare(page);
  const recording = await capture(page, "ble");

  await claim(page, recording);
  await connectStrava(page);
  await command("mode/lost");
  const before = (await state()).provider.uploads.length;

  await send(page, recording);
  await expect.poll(() => progress(recording.rideId)).toBe("submission_unknown");
  await command("restart");
  await page.reload();
  await selectRide(page, recording);
  await expect(page.locator("#strava-panel")).toContainText("Ergebnis unbekannt");
  await expect(
    page.getByRole("button", { name: "Diese Fahrt einmalig an Strava senden", exact: true }),
  ).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect((await state()).provider.uploads).toHaveLength(before + 1);
  expect(await progress(recording.rideId)).toBe("submission_unknown");
});

test("poll-restart preserves known upload ID after actual provider poll failure", async ({
  page,
}) => {
  await prepare(page);
  const recording = await capture(page, "ble");

  await claim(page, recording);
  await connectStrava(page);
  await command("mode/poll_failure");
  const before = (await state()).provider;

  await send(page, recording);
  await expect
    .poll(async () => (await state()).provider.polls.length, { timeout: 30_000 })
    .toBeGreaterThan(before.polls.length);
  const known = (await state()).deliveries.find((row) => row.rideId === recording.rideId)?.progress;
  const receipt = z.object({ receipt: z.object({ uploadId: z.string() }) }).parse(known).receipt;

  await command("restart");
  await page.reload();
  await selectRide(page, recording);
  await expect(page.locator("#strava-panel")).toContainText(`Upload ${receipt.uploadId}`);
  const after = (await state()).deliveries.find((row) => row.rideId === recording.rideId)?.progress;

  expect(z.object({ receipt: z.object({ uploadId: z.string() }) }).parse(after).receipt).toEqual(
    receipt,
  );
  expect((await state()).provider.uploads).toHaveLength(before.uploads.length + 1);
});

test("sim-blocked actual SIM capture cannot obtain a provider upload", async ({ page }) => {
  await page.goto(`${web}/?sim=1`);
  await login(page);
  await page.goto(`${web}/?sim=1`);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const recording = await capture(page, "sim");

  await claim(page, recording);
  await connectStrava(page);
  const before = (await state()).provider.uploads.length;

  await selectRide(page, recording);
  await expect(page.locator("#strava-panel")).toContainText("deklarative BLE-Richtlinie nicht");
  await expect(
    page.getByRole("button", { name: "Diese Fahrt einmalig an Strava senden", exact: true }),
  ).toHaveCount(0);
  expect((await state()).provider.uploads).toHaveLength(before);
});

test("memory-cookie actual app preserves memory session through native popup and original cookie", async ({
  page,
  context,
}) => {
  await memoryCookieFlow(page, context, false);
});

test("clock-fast actual native-boundary capture never enables trainer or provider upload", async ({
  page,
}) => {
  await prepare(page, "fast");
  const recording = await capture(page, "accelerated");

  await expect(page.locator("body")).not.toHaveAttribute("data-control-count");
  await claim(page, recording);
  await connectStrava(page);
  const before = (await state()).provider.uploads.length;

  await selectRide(page, recording);
  await expect(page.locator("#strava-panel")).toContainText("deklarative BLE-Richtlinie nicht");
  await expect(
    page.getByRole("button", { name: "Diese Fahrt einmalig an Strava senden", exact: true }),
  ).toHaveCount(0);
  expect((await state()).provider.uploads).toHaveLength(before);
});

test("missing-cookie actual callback denies exchange without losing original memory bearer", async ({
  page,
  context,
}) => {
  await memoryCookieFlow(page, context, true);
});
