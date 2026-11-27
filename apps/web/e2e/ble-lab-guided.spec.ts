/// <reference types="node" />
import { expect, test, type Page } from "@playwright/test";
import { multideviceBluetoothScript } from "./helpers/bluetoothMultidevice.js";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its mutable page fixture.
test("the lab guides each device, records without clicks and keeps one log per device", async ({
  page,
}: {
  page: Page;
}) => {
  await page.addInitScript({ content: multideviceBluetoothScript() });
  await page.goto("/debug/ble.html");
  await expect(page.getByRole("heading", { name: "So nimmst du ein Gerät auf" })).toBeVisible();
  await expect(page.locator("#guide")).toContainText("Gerät hinzufügen");
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await page.evaluate(() => document.dispatchEvent(new Event("multi-read-trainer")));
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#selected-device")).toContainText("left");
  // This fake grip lacks …03/…04, so the lab must not claim a Zwift handshake for it.
  await expect(page.locator("#guide-title")).toContainText("Unbekanntes Gerät");
  await expect(
    page.getByRole("button", { name: "Zwift-Controller-Handshake", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("multi-notify-trainer"));
    document.dispatchEvent(new Event("multi-notify-left"));
  });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator("#log")).toContainText("rx  Zwift Daten");
  await expect(page.locator("#log")).not.toContainText("Indoor Bike Data");
  await page.getByRole("tab", { name: /trainer/u }).click();
  await expect(page.locator("#guide-title")).toContainText("Trainer nur mit Messwerten");
  await expect(
    page.getByRole("button", { name: "FTMS Request Control + Start + Sim 0 %", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#log")).toContainText("rx  Indoor Bike Data");
  await expect(page.locator("#log")).not.toContainText("Zwift Daten");
  const downloads: string[] = [];
  page.on("download", (download: Readonly<{ suggestedFilename: () => string }>) => {
    downloads.push(download.suggestedFilename());
  });
  await page.getByRole("button", { name: "Alle exportieren", exact: true }).click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.toSorted()).toEqual([
    expect.stringMatching(/^ble-1-test-trainer-/u),
    expect.stringMatching(/^ble-2-zwift-play-/u),
  ]);
  await expect(page.locator("body")).not.toHaveAttribute("data-unexpected-write");
  await page.screenshot({ path: test.info().outputPath("guided-lab.png"), fullPage: true });
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its mutable page fixture.
test("log tabs follow the tabs pattern and keep keyboard focus across capture updates", async ({
  page,
}: {
  page: Page;
}) => {
  await page.addInitScript({ content: multideviceBluetoothScript() });
  await page.goto("/debug/ble.html");
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event("multi-read-trainer")));
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  await expect(page.locator("#selected-device")).toContainText("left");
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("tabindex", "0");
  await expect(tabs.nth(0)).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#log")).toHaveAttribute("aria-labelledby", "log-tab-2");
  await tabs.nth(1).focus();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("multi-notify-left"));
    document.dispatchEvent(new Event("multi-notify-trainer"));
  });
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(0)).toBeFocused();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#selected-device")).toContainText("trainer");
  await expect(page.locator("#log")).toHaveAttribute("aria-labelledby", "log-tab-1");
  await page.keyboard.press("End");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.locator("#devices .device-counts").first()).not.toContainText(" 0 empfangen");
});
