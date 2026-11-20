/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { parseBleFixtureJson, type BleFixture } from "@voltonaut/ble";
import { multideviceBluetoothScript } from "./helpers/bluetoothMultidevice.js";

type LabPage = Readonly<
  Pick<
    Page,
    | "addInitScript"
    | "goto"
    | "getByRole"
    | "locator"
    | "getByLabel"
    | "evaluate"
    | "waitForEvent"
    | "screenshot"
  >
>;

async function openDevice(page: LabPage, id: string): Promise<void> {
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#selected-device")).toContainText(id);
  await expect(page.locator("#status")).toHaveText("ready");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsubscribe", exact: true })).toBeEnabled();
  await page.getByLabel("Firmware", { exact: true }).fill(`firmware-${id}`);
  await page.getByLabel("Notizen", { exact: true }).fill(`notes-${id}`);
}

async function openDevices(page: LabPage): Promise<void> {
  await page.addInitScript({ content: multideviceBluetoothScript() });
  await page.goto("/debug/ble.html");
  await openDevice(page, "trainer");
  await openDevice(page, "left");
  await openDevice(page, "right");
}

async function choose(page: LabPage, id: string): Promise<void> {
  await page.locator("#devices button").filter({ hasText: id }).click();
  await expect(page.locator("#selected-device")).toContainText(id);
}

async function emitAll(page: LabPage): Promise<void> {
  await page.evaluate(() => {
    for (const id of ["trainer", "left", "right"]) {
      document.dispatchEvent(new Event(`multi-notify-${id}`));
    }
  });
}

function readFixture(path: string): BleFixture {
  const parsed = parseBleFixtureJson(readFileSync(path, "utf8"));

  if (!parsed.ok) {
    throw new Error(parsed.failure.reason);
  }

  return parsed.value;
}

async function exportDevice(page: LabPage, id: string): Promise<BleFixture> {
  await choose(page, id);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON exportieren", exact: true }).click();
  const download = await pending;
  const fixture = readFixture(await download.path());
  expect(fixture.meta.deviceId).toBe(id);
  expect(fixture.meta.firmware).toBe(`firmware-${id}`);
  expect(fixture.meta.notes).toBe(`notes-${id}`);
  await download.saveAs(test.info().outputPath(`${id}.json`));

  return fixture;
}

async function assertCapture(page: LabPage, id: string, count: number): Promise<void> {
  const fixture = await exportDevice(page, id);

  const expectedHex =
    id === "trainer" ? "45 00 b4 00 f4 00" : `07 08 ${id === "left" ? "01" : "00"} 30 01`;

  expect(fixture.log.filter((entry) => entry.kind === "data")).toHaveLength(count);
  expect(fixture.log.every((entry) => entry.kind === "event" || entry.hex === expectedHex)).toBe(
    true,
  );
  expect(fixture.log).not.toContainEqual(expect.objectContaining({ kind: "data", dir: "tx" }));
}

test("three ready devices capture independently, duplicate selection preserves every link", async ({
  page,
}: Readonly<{ page: LabPage }>) => {
  await openDevices(page);
  await expect(page.locator("#devices article.ready")).toHaveCount(3);
  await expect(page.locator("#devices button").filter({ hasText: "Zwift Play" })).toHaveCount(2);
  await emitAll(page);
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#selected-device")).toContainText("left");
  await expect(page.locator("#devices article")).toHaveCount(3);
  await expect(page.locator("body")).toHaveAttribute("data-left-connects", "1");
  await expect(page.locator("body")).not.toHaveAttribute("data-left-disconnects");
  await emitAll(page);

  await assertCapture(page, "trainer", 2);
  await assertCapture(page, "left", 2);
  await assertCapture(page, "right", 2);
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Unsubscribe", exact: true })).toBeEnabled();

  await expect(page.locator("body")).not.toHaveAttribute("data-unexpected-write");
  await page.screenshot({ path: test.info().outputPath("three-ready.png"), fullPage: true });
});

test("disconnecting only left preserves all captures and the other notification streams", async ({
  page,
}: Readonly<{ page: LabPage }>) => {
  await openDevices(page);
  await emitAll(page);
  await choose(page, "left");
  await page.getByRole("button", { name: "Trennen", exact: true }).click();
  await expect(page.locator("#devices article.disconnected")).toHaveCount(1);
  await expect(page.locator("#devices article.ready")).toHaveCount(2);
  await emitAll(page);

  await assertCapture(page, "trainer", 2);
  await assertCapture(page, "left", 1);
  await assertCapture(page, "right", 2);

  await expect(page.locator("body")).toHaveAttribute("data-left-disconnects", "1");
  await expect(page.locator("body")).not.toHaveAttribute("data-trainer-disconnects");
  await expect(page.locator("body")).not.toHaveAttribute("data-right-disconnects");
});

test("pending trainer read does not block right; late error restores only trainer status", async ({
  page,
}: Readonly<{ page: LabPage }>) => {
  await openDevices(page);
  await choose(page, "trainer");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await choose(page, "right");
  await page.getByRole("button", { name: "Unsubscribe", exact: true }).click();
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsubscribe", exact: true })).toBeEnabled();
  await page.getByLabel("Marker", { exact: true }).fill("right stays usable");
  await page.getByRole("button", { name: "Marker setzen", exact: true }).click();
  await expect(page.locator("#log")).toContainText("right stays usable");
  await page.evaluate(() => document.dispatchEvent(new Event("multi-fail-trainer")));
  await expect(page.locator("#devices article.error")).toHaveCount(1);
  await expect(page.locator("#status")).toHaveText("ready");
  await expect(page.locator("#log")).not.toContainText("read failed");
  await choose(page, "trainer");
  await expect(page.locator("#status")).toContainText("read failed trainer");
  await expect(page.locator("#log")).toContainText("error: read failed trainer");
  await emitAll(page);
  const fixture = await exportDevice(page, "trainer");
  expect(fixture.log).toContainEqual(expect.objectContaining({ kind: "data" }));
  await assertCapture(page, "right", 1);
});

test("queued export keeps the clicked device and metadata after selecting another device", async ({
  page,
}: Readonly<{ page: LabPage }>) => {
  await openDevices(page);
  await choose(page, "trainer");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.getByLabel("Firmware", { exact: true }).fill("firmware-at-click");
  await page.getByLabel("Notizen", { exact: true }).fill("notes-at-click");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON exportieren", exact: true }).click();
  await choose(page, "right");
  await page.evaluate(() => document.dispatchEvent(new Event("multi-read-trainer")));
  const download = await pending;
  const fixture = readFixture(await download.path());
  expect(fixture.meta.deviceId).toBe("trainer");
  expect(fixture.meta.firmware).toBe("firmware-at-click");
  expect(fixture.meta.notes).toBe("notes-at-click");
  await expect(page.locator("#selected-device")).toContainText("right");
  await expect(page.getByLabel("Firmware", { exact: true })).toHaveValue("firmware-right");
});

test("late trainer connection never selects over right and adding remains available", async ({
  page,
}: Readonly<{ page: LabPage }>) => {
  await page.addInitScript({ content: multideviceBluetoothScript() });
  await page.goto("/debug/ble.html");
  await page.evaluate(() => {
    document.body.dataset["delayConnect"] = "trainer";
  });
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#devices article.connecting")).toHaveCount(1);
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#selected-device")).toContainText("right");
  await expect(page.locator("#status")).toHaveText("ready");
  const payload = page.getByLabel("Payload 00000002-19ca-4651-86e5-fa29dcdd09d1");
  await payload.fill("00");
  await page.evaluate(() => document.dispatchEvent(new Event("multi-connect-trainer")));
  await expect(page.locator("#devices article.ready")).toHaveCount(3);
  await expect(page.locator("#selected-device")).toContainText("right");
  await expect(page.locator("#status")).toHaveText("ready");
  await expect(payload).toHaveValue("00");
});
