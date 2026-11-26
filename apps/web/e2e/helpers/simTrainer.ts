import type { Page } from "@playwright/test";

type DevicePage = Readonly<Pick<Page, "getByRole">>;

function trainerSlot(page: DevicePage) {
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });

  const trainer = devices
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Trainer", exact: true }) });

  return { devices, trainer };
}

async function switchSimTrainer(
  page: DevicePage,
  action: "Trennen" | "Gerät wählen",
  status: "disconnected" | "ready",
): Promise<void> {
  const { devices, trainer } = trainerSlot(page);

  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  await trainer.getByRole("button", { name: action, exact: true }).click();
  // The raw status sits in collapsed technical details: wait for its text, not its visibility.
  await trainer
    .getByLabel("Trainer Status")
    .filter({ hasText: status })
    .waitFor({ state: "attached" });
  await devices.getByRole("button", { name: "Schließen", exact: true }).click();
}

/**
 * Disconnects the Sim trainer through the device dialog, so no trainer data reaches the ride.
 * A later capture window then stays empty however long clicks take under load.
 */
export function disconnectSimTrainer(page: DevicePage): Promise<void> {
  return switchSimTrainer(page, "Trennen", "disconnected");
}

/** Connects the Sim trainer again through the device dialog; the ride resumes on its data. */
export function connectSimTrainer(page: DevicePage): Promise<void> {
  return switchSimTrainer(page, "Gerät wählen", "ready");
}
