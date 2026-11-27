/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { parseBleFixtureJson, type BleFixture } from "@voltonaut/ble";
import { SNIFFER_FIXTURE } from "@voltonaut/ble/testdata";
import { bluetoothFakeScript } from "./helpers/bluetooth.js";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its mutable page object.
async function openReplay(page: Page): Promise<void> {
  const start = new Date("2026-11-20T10:00:00.000Z");
  await page.clock.install({ time: start });
  // Only explicit clock advances may move the replay, regardless of automation speed.
  await page.clock.pauseAt(start);
  await page.route(
    (url: { readonly pathname: string }) => url.pathname === "/replay.json",
    (
      route: Readonly<{
        fulfill: (options: Readonly<{ body: string; contentType: string }>) => Promise<void>;
      }>,
    ) =>
      route.fulfill({
        body: JSON.stringify(SNIFFER_FIXTURE),
        contentType: "application/json",
      }),
  );
  await page.goto("/debug/ble.html?replay=/replay.json");
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await page.getByText("GATT-Explorer für Fortgeschrittene", { exact: true }).click();
}

function parseDownload(text: string): BleFixture {
  const parsed = parseBleFixtureJson(text);

  if (!parsed.ok) {
    throw new Error(parsed.failure.reason);
  }

  return parsed.value;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its mutable page object.
async function runFtmsPresets(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "FTMS Request Control + Start + Sim 0 %", exact: true })
    .click();
  await expect(page.locator("#log")).toContainText("tx  FTMS Control Point  00");
  // Each step processes one reply (00 at 1000 ms, 07 at 1250 ms, 11 at 1500 ms) and its polling tick.
  await page.clock.runFor(600);
  await expect(page.locator("#log")).toContainText("tx  FTMS Control Point  07");
  await expect(page.locator("#log")).not.toContainText("11 00 00 00 00 28 33");
  await page.clock.runFor(250);
  await expect(page.locator("#log")).toContainText("11 00 00 00 00 28 33");
  await expect(page.locator("#log")).not.toContainText("Preset abgeschlossen");
  await page.clock.runFor(250);
  await expect(page.locator("#log")).toContainText("Preset abgeschlossen");
  await page.getByRole("button", { name: "FTMS Sim 5 %", exact: true }).click();
  await expect(page.locator("#log")).toContainText("11 00 00 f4 01 28 33");
  await page.clock.runFor(300);
  await expect(page.locator("#log")).toContainText("Preset abgeschlossen: FTMS Sim 5 %");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its mutable browser fixture.
test("replay sniffer explores, captures, waits for preset indications and exports valid JSON", async ({
  page,
}) => {
  await openReplay(page);
  await expect(page.getByText("Descriptors: 00002901", { exact: false })).toBeVisible();
  await expect(page.getByText("Presets verändern den Widerstand", { exact: false })).toBeVisible();
  // Standard notify/indicate channels record from connect on; 0x2ACC is read automatically.
  // The trainer's proprietary Zwift channels (…02, …04) stay manual (ADR-001).
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toHaveCount(5);
  await expect(page.locator("#gatt button:enabled", { hasText: /^Unsubscribe$/u })).toHaveCount(3);
  await expect(page.locator("#gatt button:enabled", { hasText: /^Subscribe$/u })).toHaveCount(2);

  await expect(page.locator("#log")).toContainText("FTMS Fähigkeiten  2b 14");
  await page.clock.runFor(500);
  await expect(page.locator("#log")).toContainText('"powerW":250');
  await expect(page.locator("#log")).toContainText('"bpm":64');
  await runFtmsPresets(page);
  // A trainer's proprietary Zwift service stays unused (ADR-001).
  await expect(
    page.getByRole("button", { name: "Zwift-Controller-Handshake", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Marker", { exact: true }).fill("RS gedrückt");
  await page.getByRole("button", { name: "Marker setzen" }).click();
  await page.getByLabel("Filter", { exact: true }).fill("RS gedrückt");
  await expect(page.locator("#log")).toContainText("RS gedrückt");
  await expect(page.locator("#log")).not.toContainText("2b 14");
  await page.getByLabel("Filter", { exact: true }).fill("");
  await page.getByRole("button", { name: "Anzeige pausieren" }).click();
  await page.getByLabel("Marker", { exact: true }).fill("paused capture");
  await page.getByRole("button", { name: "Marker setzen" }).click();
  await expect(page.locator("#log")).not.toContainText("paused capture");
  await page.getByRole("button", { name: "Anzeige fortsetzen" }).click();
  await expect(page.locator("#log")).toContainText("paused capture");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const path = await (await downloaded).path();
  const parsed = parseDownload(readFileSync(path, "utf8"));
  expect(parsed.gatt).toHaveLength(3);
  expect(parsed.log).toContainEqual(expect.objectContaining({ marker: "RS gedrückt" }));
  expect(parsed.log[0]?.tMs).toBeLessThan(100);
  expect(parsed.log.at(-1)?.tMs).toBeLessThan(5000);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its mutable browser fixture.
test("explorer validates hex and ASCII writes, unsubscribes and disconnects", async ({ page }) => {
  await openReplay(page);
  const payload = page.getByLabel("Payload 00002ad9-0000-1000-8000-00805f9b34fb");
  const encoding = page.getByLabel("Encoding 00002ad9-0000-1000-8000-00805f9b34fb");
  await payload.fill("not hex");
  await page.getByRole("button", { name: "Write", exact: true }).first().click();
  await expect(page.locator("#status")).toContainText("Ungültige Hex-Bytes");
  await payload.fill("00");
  await page.getByRole("button", { name: "Write", exact: true }).first().click();
  await expect(page.locator("#log")).toContainText("tx  FTMS Control Point  00");
  await encoding.selectOption({ label: "ASCII" });
  await payload.fill("ä");
  await page.getByRole("button", { name: "Write", exact: true }).first().click();
  await expect(page.locator("#status")).toContainText("Ungültiges ASCII");
  await payload.fill("RideOn");
  await page.getByRole("button", { name: "Write", exact: true }).first().click();
  await expect(page.locator("#log")).toContainText("52 69 64 65 4f 6e");
  // 0x2AD2 records from connect on; unsubscribing stops it before its first frame.
  await page.getByRole("button", { name: "Unsubscribe", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Subscribe", exact: true }).first()).toBeEnabled();
  await page.clock.fastForward(500);
  await expect(page.locator("#log")).not.toContainText('"powerW"');
  await page.getByRole("button", { name: "Trennen", exact: true }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-state", "disconnected");
  await expect(page.locator("#log")).toContainText("○ getrennt");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its mutable browser fixture.
test("native picker stays in the synchronous click; remembered reconnect never selects or writes", async ({
  page,
}) => {
  await page.addInitScript({ content: bluetoothFakeScript() });
  await page.goto("/debug/ble.html");
  const choose = page.getByRole("button", { name: "Gerät hinzufügen", exact: true });
  await choose.click();
  await expect(page.locator("#picker-status")).toContainText("picker cancelled");
  await choose.click();
  await expect(page.locator("#picker-status")).toContainText("radio unavailable");
  await choose.click();
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("body")).toHaveAttribute("data-trainer-selections", "3");
  await page.getByRole("button", { name: "Erneut verbinden", exact: true }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("body")).toHaveAttribute("data-trainer-selections", "3");
  await choose.click();
  await expect(page.locator("#selected-device")).toContainText("Test trainer");
  await expect(page.locator("body")).toHaveAttribute("data-trainer-selections", "4");
  await expect(page.locator("body")).not.toHaveAttribute("data-ble-write");
});
