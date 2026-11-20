import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--disable-webgl"] } });

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("keeps the HUD and keyboard ride usable without WebGL", async ({ page }) => {
  await page.goto("/?sim=1&clock=fast");
  await expect(page.getByRole("region", { name: "Ride world" }).getByRole("status")).toContainText(
    "3D unavailable",
  );
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect(page.getByTestId("hud-distance")).not.toHaveText("0.00 km");
});
