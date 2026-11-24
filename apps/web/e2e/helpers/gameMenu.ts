import type { Page } from "@playwright/test";

export async function openGameMenu(
  page: Readonly<Pick<Page, "getByRole">>,
  tab: "Profil" | "Aufnahmen" | "Konto" | "Strava" | "Garage / Shop",
): Promise<void> {
  const menu = page.getByRole("dialog", { name: "Fahrtmenü" });
  const visible = await menu.isVisible();

  if (!visible) {
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
