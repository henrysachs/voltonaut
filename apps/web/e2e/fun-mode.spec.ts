import { expect, test, type Page, type TestInfo } from "@playwright/test";

type FunPage = Readonly<
  Pick<Page, "goto" | "getByTestId" | "getByRole" | "getByLabel" | "screenshot">
> & {
  readonly keyboard: Readonly<Pick<Page["keyboard"], "press">>;
};

const EMPTY_SLOT = "Spaß-Modus · nächste Item-Box sammeln";

async function chooseMode(page: FunPage, label: "Normal" | "Spaß (Item-Boxen)"): Promise<void> {
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("radio", { name: label }).check();
  await page.getByRole("button", { name: "Zurück zur Fahrt", exact: true }).click();
}

test("fun mode collects an item box, triggers it with P and lets it expire", async ({
  page,
}: { readonly page: FunPage }, testInfo: Readonly<Pick<TestInfo, "outputPath">>) => {
  await page.goto("/?sim=1&clock=fast");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.getByTestId("hud-item")).toBeHidden();

  await chooseMode(page, "Spaß (Item-Boxen)");
  await expect(page.getByTestId("hud-item")).toHaveText(EMPTY_SLOT);

  // The first box stands at 300 m.
  await expect(page.getByTestId("hud-item")).toContainText("bereit", { timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath("fun-mode-held-item.png") });

  await page.keyboard.press("p");
  await expect(page.getByTestId("hud-item")).toContainText("aktiv");
  await page.screenshot({ path: testInfo.outputPath("fun-mode-active-item.png") });
  await expect(page.getByTestId("hud-item")).toHaveText(EMPTY_SLOT, { timeout: 20_000 });

  await chooseMode(page, "Normal");
  await expect(page.getByTestId("hud-item")).toBeHidden();
});

test("the mode picker explains fun mode and keeps the ride running", async ({
  page,
}: {
  readonly page: FunPage;
}) => {
  await page.goto("/?sim=1&clock=fast");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("radio", { name: "Spaß (Item-Boxen)" }).check();
  await expect(page.getByRole("group", { name: "Spielmodus" })).toContainText(
    "Spätere Aufnahmen dieser Sitzung bleiben nur lokal.",
  );
  await expect(page.getByTestId("hud-item")).toHaveText(EMPTY_SLOT);
});
