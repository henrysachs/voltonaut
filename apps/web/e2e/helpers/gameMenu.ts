import type { Page } from "@playwright/test";

export async function openGameMenu(
  page: Readonly<Pick<Page, "getByRole" | "locator">>,
  tab: "Profil" | "Aufnahmen" | "Konto" | "Strava" | "App" | "Garage / Shop",
): Promise<void> {
  const menu = page.getByRole("dialog", { name: "Fahrtmenü" });

  if ((await page.locator("#game-menu").getAttribute("open")) === null) {
    await page.getByRole("button", { name: "Menü", exact: true }).click();
  }

  await menu.getByRole("tab", { name: tab, exact: true }).click();
  await menu.getByRole("tabpanel", { name: tab, exact: true }).waitFor({ state: "visible" });
}

export async function closeGameMenu(page: Readonly<Pick<Page, "getByRole">>): Promise<void> {
  const menu = page.getByRole("dialog", { name: "Fahrtmenü" });

  if (await menu.isVisible()) {
    await menu.getByRole("button", { name: "Zurück zur Fahrt", exact: true }).click();
  }
}
