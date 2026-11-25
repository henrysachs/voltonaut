import type { Page } from "@playwright/test";

/**
 * Disconnects the Sim trainer through the device dialog, so no trainer data reaches the ride.
 * A later capture window then stays empty however long clicks take under load.
 */
export async function disconnectSimTrainer(page: Readonly<Pick<Page, "getByRole">>): Promise<void> {
  const devices = page.getByRole("dialog", { name: "Bluetooth-Geräte", exact: true });

  const trainer = devices
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Trainer", exact: true }) });

  await page.getByRole("button", { name: "Geräte verbinden", exact: true }).click();
  await trainer.getByRole("button", { name: "Trennen", exact: true }).click();
  // The raw status sits in collapsed technical details: wait for its text, not its visibility.
  await trainer
    .getByLabel("Trainer Status")
    .filter({ hasText: "disconnected" })
    .waitFor({ state: "attached" });
  await devices.getByRole("button", { name: "Schließen", exact: true }).click();
}
