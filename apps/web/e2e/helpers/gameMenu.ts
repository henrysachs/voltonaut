import type { Page } from "@playwright/test";

export async function openGameMenu(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable Page contract; navigation uses its public controls.
  page: Readonly<Page>,
  tab: "Profil" | "Aufnahmen" | "Konto" | "Strava",
): Promise<void> {
  const menu = page.getByRole("dialog", { name: "Fahrtmenü" });
  const visible = await menu.isVisible();

  if (!visible) {
    await page.getByRole("button", { name: "Menü", exact: true }).click();
  }

  await menu.getByRole("tab", { name: tab, exact: true }).click();
  await menu.getByRole("tabpanel", { name: tab, exact: true }).waitFor({ state: "visible" });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable Page contract; this helper closes only the game menu.
export async function closeGameMenu(page: Readonly<Page>): Promise<void> {
  const menu = page.getByRole("dialog", { name: "Fahrtmenü" });

  if (await menu.isVisible()) {
    await menu.getByRole("button", { name: "Zurück zur Fahrt", exact: true }).click();
  }
}
