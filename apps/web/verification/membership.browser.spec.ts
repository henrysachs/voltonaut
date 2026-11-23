import { expect, test, type Page } from "@playwright/test";
import { AccountStatusSchema, SessionResponseSchema } from "@voltonaut/shared";
import { openGameMenu } from "../e2e/helpers/gameMenu.js";

const web = process.env["WEB_ORIGIN"] ?? "";
const api = process.env["API_ORIGIN"] ?? "";
const control = process.env["MEMBERSHIP_CONTROL"] ?? "";
const artifacts = process.env["AUTH_ARTIFACTS"] ?? "";

type Browser = Readonly<
  Pick<
    Page,
    "goto" | "getByRole" | "waitForResponse" | "getByTestId" | "locator" | "reload" | "screenshot"
  >
>;

async function command(path: string): Promise<void> {
  expect((await fetch(`${control}/${path}`, { method: "POST" })).status).toBe(204);
}

async function login(page: Browser) {
  await openGameMenu(page, "Konto");
  const pending = page.waitForResponse(`${api}/v1/auth/oidc/exchange`);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const raw: unknown = await response.json();
  const session = SessionResponseSchema.parse(raw);
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    session.user.email,
  );

  return session;
}

async function prepare(page: Browser) {
  await command("member");
  const member = await login(page);
  await expect(page.locator("#account-membership")).toHaveText("Mitgliedschaft: Normal");
  await expect(page.getByRole("heading", { name: "Nutzerverwaltung" })).toHaveCount(0);
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await command("operator");
  const operator = await login(page);
  await command(`grant/${operator.user.id}`);
  await page.goto(`${web}/?sim=1&debug=1`);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("heading", { name: "Nutzerverwaltung" })).toBeVisible();

  return { member, operator };
}

async function edit(page: Browser, email: string): Promise<void> {
  const form = page.getByRole("form", { name: `Mitgliedschaft ${email}` });
  const gear = await page.getByTestId("hud-gear").textContent();
  const distance = await page.getByTestId("hud-distance").textContent();
  const camera = await page.locator(".scene__camera").textContent();
  const select = form.getByLabel("Mitgliedsstufe");
  await select.focus();
  await select.press("ArrowDown");
  await select.press("ArrowUp");
  await select.press("c");
  await expect(page.getByTestId("hud-gear")).toHaveText(String(gear));
  await expect(page.locator(".scene__camera")).toHaveText(String(camera));
  await select.selectOption("pro");
  await form.getByLabel("VIP", { exact: true }).check();
  const saved = page.waitForResponse(/\/v1\/admin\/users\/[^/]+\/membership$/u);
  await form.getByRole("button", { name: "Mitgliedschaft speichern" }).click();
  expect((await saved).status()).toBe(200);
  await expect(form.getByLabel("Mitgliedsstufe")).toHaveValue("pro");
  await expect(form.getByLabel("VIP", { exact: true })).toBeChecked();
  await expect(page.getByTestId("hud-distance")).not.toHaveText(String(distance));
}

test("signed public account UI assigns independent membership, preserves riding and removes revoked administration", async ({
  page,
}: {
  readonly page: Browser;
}) => {
  await page.goto(`${web}/?sim=1&debug=1`);
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const { member, operator } = await prepare(page);
  await edit(page, member.user.email);

  await page.screenshot({ path: `${artifacts}/membership-admin.png` });
  await command(`revoke/${operator.user.id}`);
  await page.getByRole("button", { name: "Nutzerliste aktualisieren" }).click();
  await expect(page.getByRole("heading", { name: "Nutzerverwaltung" })).toHaveCount(0);
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await expect(page.locator("#account-membership")).toBeEmpty();
  await command("member");

  const activeMember = await login(page);
  await expect(page.locator("#account-membership")).toHaveText("Mitgliedschaft: Pro · VIP");
  await expect(page.getByRole("heading", { name: "Nutzerverwaltung" })).toHaveCount(0);

  const response = await fetch(`${api}/v1/me/account-status`, {
    headers: { Authorization: `Bearer ${activeMember.sessionToken}` },
  });

  const raw: unknown = await response.json();

  expect(AccountStatusSchema.parse(raw)).toEqual({
    membership: { tier: "pro", vip: true },
    authorization: { role: "user" },
  });

  const forbidden = await fetch(`${api}/v1/admin/users`, {
    headers: { Authorization: `Bearer ${activeMember.sessionToken}` },
  });

  expect(forbidden.status).toBe(403);
  await page.screenshot({ path: `${artifacts}/membership-member.png` });
});
