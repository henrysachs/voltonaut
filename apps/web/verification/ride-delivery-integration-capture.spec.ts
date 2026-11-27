/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- Public controls and read-only IDB observation use native Playwright handles.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  RecordingV2Schema,
  RideReceiptSchema,
  type RecordingV2,
  type SessionResponse,
} from "@voltonaut/shared";
import { z } from "../../../packages/shared/node_modules/zod/index.js";
import { closeGameMenu, openGameMenu } from "../e2e/helpers/gameMenu.js";
import { api, artifacts, login, save, web } from "./ride-delivery-integration-runtime.spec.js";
import { assertProtocol } from "./ride-delivery-integration-protocol.spec.js";

async function choose(page: Page, heading: string): Promise<void> {
  const row = page
    .getByRole("dialog")
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

  await row.getByRole("button", { name: "Gerät wählen" }).click();
  await expect(row.getByLabel(`${heading} Status`)).toHaveText("ready");
}

export async function prepare(
  page: Page,
  clock: "real" | "fast" = "real",
): Promise<SessionResponse> {
  await page.goto(`${web}/?debug=1`);
  const session = await login(page);

  if (clock === "fast") await page.goto(`${web}/?clock=fast`);
  await closeGameMenu(page);
  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  await choose(page, "Trainer");
  await choose(page, "Linker Controller");
  await choose(page, "Rechter Controller");
  await expect(page.getByTestId("hud-power")).toHaveText("244 W", { timeout: 10_000 });
  await expect(page.locator("body")).not.toHaveAttribute("data-control-count");
  await page.getByRole("button", { name: "Widerstand aktivieren", exact: true }).click();

  if (clock === "real") {
    await expect(page.getByRole("group", { name: "Rollenschaltung", exact: true })).toHaveAttribute(
      "data-authority",
      "active",
    );
    await expect(page.locator("body")).toHaveAttribute("data-control-opcodes", /^0,7,17,17/u);
  } else {
    await expect(page.getByLabel("Rollenschaltung Status")).toContainText("Echtzeit");
    await expect(page.locator("body")).not.toHaveAttribute("data-control-count");
  }

  await page.getByRole("button", { name: "Schließen", exact: true }).click();

  return session;
}

export function readArchive(): Promise<string> {
  return new Promise((resolve, reject) => {
    const opened = indexedDB.open("voltonaut-local-rides");

    opened.addEventListener("upgradeneeded", () => {
      opened.transaction?.abort();
      reject(new Error("Product archive must already exist"));
    });
    opened.addEventListener("error", () => {
      reject(new Error("Cannot observe product archive"));
    });
    opened.addEventListener("success", () => {
      const database = opened.result;
      const transaction = database.transaction("completed", "readonly");
      const rows = transaction.objectStore("completed").getAll();

      transaction.addEventListener("complete", () => {
        database.close();
        resolve(JSON.stringify(rows.result));
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(new Error("Archive observation aborted"));
      });
    });
  });
}

async function shiftDuringCapture(page: Page): Promise<void> {
  const initial = Number(await page.locator("body").getAttribute("data-control-grade"));

  await page.evaluate(() => document.dispatchEvent(new Event("test-control-right-down")));
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect
    .poll(async () => Number(await page.locator("body").getAttribute("data-control-grade")))
    .toBeGreaterThan(initial);
  const higher = Number(await page.locator("body").getAttribute("data-control-grade"));

  await expect(page.getByLabel("Trainer-ACK")).toContainText(
    `${higher.toFixed(2)} % · Ziel bestätigt`,
  );
  await page.evaluate(() => {
    document.dispatchEvent(new Event("test-control-right-up"));
    document.dispatchEvent(new Event("test-control-left-down"));
  });
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await expect
    .poll(async () => Number(await page.locator("body").getAttribute("data-control-grade")))
    .toBeLessThan(higher);
  await expect(page.getByLabel("Trainer-ACK")).toContainText("Ziel bestätigt");
  await page.evaluate(() => document.dispatchEvent(new Event("test-control-left-up")));
  await expect(page.locator("body")).not.toHaveAttribute("data-control-unexpected-write");
  await save("ftms.json", (await page.locator("body").getAttribute("data-control-writes")) ?? "[]");
}

type CaptureMode = "ble" | "sim" | "accelerated";

function parseArchive(raw: string): readonly RecordingV2[] {
  return z
    .array(z.unknown())
    .parse(JSON.parse(raw))
    .map((entry): RecordingV2 => RecordingV2Schema.parse(entry));
}

function assertCapture(recording: RecordingV2, mode: CaptureMode): void {
  expect(recording.initialization.source).toBe(mode === "sim" ? "sim" : "ble");
  expect(recording.initialization.clockScale).toBe(mode === "accelerated" ? 20 : 1);
  expect(recording.journalState).toBe("complete");
  expect(recording.window.startSeq).toBeGreaterThan(0);
  expect(
    recording.entries.some(
      (entry) => entry[2] === "advance" && entry[0] < recording.window.startSeq,
    ),
  ).toBe(true);

  if (mode === "ble") {
    expect(
      recording.entries.some(
        (entry) =>
          entry[2] === "shift" && entry[3] === "shiftUp" && entry[0] > recording.window.startSeq,
      ),
    ).toBe(true);
    expect(
      recording.entries.some(
        (entry) =>
          entry[2] === "shift" && entry[3] === "shiftDown" && entry[0] > recording.window.startSeq,
      ),
    ).toBe(true);
  }
}

export async function capture(page: Page, mode: CaptureMode): Promise<RecordingV2> {
  const before = parseArchive(await page.evaluate(readArchive));

  await openGameMenu(page, "Aufnahmen");
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Aufnahme läuft");
  const started = performance.now();

  if (mode === "ble") await shiftDuringCapture(page);
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
  expect(performance.now() - started).toBeGreaterThan(1000);
  const archive = await page.evaluate(readArchive);

  await save("archive.json", archive);
  const rows = parseArchive(archive);
  const recording = rows.find((row) => !before.some((old) => old.rideId === row.rideId));

  assert.ok(recording);
  assertCapture(recording, mode);

  if (mode === "ble") await assertProtocol(page, recording);

  return recording;
}

export async function claim(page: Page, recording: RecordingV2): Promise<void> {
  await openGameMenu(page, "Konto");
  await page
    .getByRole("button", { name: "Kontodaten und lokales Archiv aktualisieren", exact: true })
    .click();

  const upload = page.waitForResponse(
    (response) => response.url() === `${api}/v2/rides` && response.request().method() === "POST",
  );

  const dialog = page.waitForEvent("dialog");

  const click = page
    .locator(`[data-local-ride-id="${recording.rideId}"]`)
    .getByRole("button")
    .click();

  await (await dialog).accept();
  await click;
  const response = await upload;

  expect(response.status()).toBe(200);
  const raw: unknown = await response.json();
  const receipt = RideReceiptSchema.parse(raw);

  expect(receipt.rideId).toBe(recording.rideId);
  assert.equal(receipt.assessment.status, "replayed");
  expect(receipt.assessment.source.assurance).toBe("client_declared");
  expect(receipt.assessment.source.declaredSource).toBe(recording.initialization.source);
  expect(receipt.assessment.source.window.kind).toBe(
    recording.initialization.source === "ble" && recording.initialization.clockScale === 1
      ? "continuous"
      : "blocked",
  );
  await expect(page.locator(`[data-outbox-id="${recording.rideId}"]`)).toContainText(
    "Auf Server gespeichert",
  );
  await writeFile(join(artifacts, `capture-${recording.rideId}.json`), JSON.stringify(recording));
  await save("receipt.json", JSON.stringify(receipt, null, 2));
}
