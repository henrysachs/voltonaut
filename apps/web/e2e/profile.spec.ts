import { expect, test } from "@playwright/test";
import { openGameMenu } from "./helpers/gameMenu.js";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's fixture object is an external mutable type; it cannot be narrowed from our side.
test("profile screen rejects invalid values, saves valid ones and restores them on reload", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  await openGameMenu(page, "Profil");

  const mass = page.getByTestId("profile-massKg");
  const error = page.getByTestId("profile-error");
  const status = page.getByTestId("profile-status");

  // Out of the 30-200 kg range: rejected, never stored.
  await mass.fill("250");
  await page.getByTestId("profile-save").click();
  await expect(error).toContainText("rejected");
  await expect(status).toHaveText("Not saved");

  await page.reload();
  await openGameMenu(page, "Profil");
  await expect(mass).toHaveValue("75");

  // Valid profile: saved locally and restored after the reload.
  await mass.fill("78");
  await page.getByTestId("profile-displayName").fill("Henry");
  await page.getByTestId("profile-save").click();
  await expect(error).toHaveText("");
  await expect(status).toHaveText("Saved locally");

  await page.reload();
  await openGameMenu(page, "Profil");
  await expect(mass).toHaveValue("78");
  await expect(page.getByTestId("profile-displayName")).toHaveValue("Henry");
});
