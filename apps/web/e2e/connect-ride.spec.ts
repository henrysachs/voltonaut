import { expect, test, type Locator } from "@playwright/test";
import { bluetoothFakeScript } from "./helpers/bluetooth.js";

async function retryWrongDevice(
  trainer: Readonly<Locator>,
  body: Readonly<Locator>,
): Promise<void> {
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("error");
  await expect(body).toHaveAttribute("data-trainer-selections", "3");
  await trainer.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("error");
  await expect(body).toHaveAttribute("data-trainer-selections", "3");
  await trainer.getByRole("button", { name: "Gerät wählen" }).click();
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright fixtures are external mutable browser handles.
test("BLE cancellation and retry lead through adapters and E3 worker to the ride HUD", async ({
  page,
}) => {
  await page.addInitScript({ content: bluetoothFakeScript() });
  await page.goto("/");
  await page.getByRole("button", { name: "Geräte verbinden" }).click();

  const dialog = page.getByRole("dialog");

  const trainer = dialog
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Trainer", exact: true }) });

  const heartRate = dialog
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Puls", exact: true }) });

  const status = page.getByTestId("hud-status");

  await heartRate.getByRole("button", { name: "Gerät wählen" }).click();
  await expect(heartRate.getByLabel("Puls Status")).toHaveText("ready");
  await expect(status).not.toHaveText("Bluetooth connected");
  await trainer.getByRole("button", { name: "Gerät wählen" }).click();
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("error");
  await trainer.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("error");
  await expect(status).not.toHaveText("Bluetooth connected");
  await trainer.getByRole("button", { name: "Erneut verbinden" }).click();
  await retryWrongDevice(trainer, page.locator("body"));
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("handshaking");
  await expect(status).not.toHaveText("Bluetooth connected");
  await expect(trainer.getByLabel("Trainer Status")).toHaveText("ready");
  await expect(status).toHaveText("Bluetooth connected");
  await expect(page.getByTestId("hud-power")).toHaveText("244 W", { timeout: 10_000 });
  await expect(page.getByTestId("hud-cadence")).toHaveText("90 rpm");
  await expect(page.getByTestId("hud-heart-rate")).toHaveText("132 bpm");
  await expect(page.getByTestId("hud-speed")).not.toHaveText("0.0 km/h");
  await dialog.getByRole("button", { name: "Schließen" }).click();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await page.evaluate(() => document.dispatchEvent(new Event("test-ble-disconnect")));
  await expect(status).not.toHaveText("Bluetooth connected");
  await expect(status).toHaveText("Bluetooth connected");
  await expect(page.getByTestId("hud-power")).toHaveText("244 W");
  await expect(page.locator("body")).toHaveAttribute("data-trainer-selections", "4");
  await expect(page.locator("body")).not.toHaveAttribute("data-ble-write");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright fixtures are external mutable browser handles.
test("unsupported browsers receive Bluetooth guidance and can still use the keyboard", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await expect(
    page.getByText("Web Bluetooth benötigt Chrome/Edge", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("hud-status")).not.toHaveText("Bluetooth connected");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
});
