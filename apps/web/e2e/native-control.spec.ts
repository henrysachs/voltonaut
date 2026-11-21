// oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns mutable Page, Locator and fixture handles.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { nativeControlFakeScript } from "./helpers/nativeControl.js";

async function choose(page: Page, name: string): Promise<void> {
  const row = page
    .getByRole("dialog")
    .locator("section")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

  await row.getByRole("button", { name: "Gerät wählen" }).click();
  await expect(row.getByLabel(`${name} Status`)).toHaveText("ready");
}

async function connect(page: Page, query = "?debug=1"): Promise<void> {
  await page.addInitScript({ content: nativeControlFakeScript() });
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "Geräte verbinden" }).click();
  await choose(page, "Trainer");
  await choose(page, "Play links (Ziel)");
  await choose(page, "Play rechts (Ziel)");
  await expect(page.getByTestId("hud-power")).toHaveText("244 W", { timeout: 10_000 });
  await expect(page.locator("body")).not.toHaveAttribute("data-control-count");
}

async function enable(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Rollenschaltung aktivieren", exact: true }).click();
  await expect(page.getByRole("group", { name: "Rollenschaltung", exact: true })).toHaveAttribute(
    "data-authority",
    "active",
  );
  await expect
    .poll(async () => Number(await page.locator("body").getAttribute("data-control-count")))
    .toBeGreaterThan(3);
}

async function grade(page: Page): Promise<number> {
  return Number(await page.locator("body").getAttribute("data-control-grade"));
}

async function writeLog(page: Page): Promise<string> {
  return (await page.locator("body").getAttribute("data-control-writes")) ?? "[]";
}

async function saveProtocol(page: Page, testInfo: TestInfo): Promise<void> {
  const path = testInfo.outputPath("native-ftms-writes.json");
  await writeFile(path, await writeLog(page));
  await testInfo.attach("native-ftms-writes.json", { path, contentType: "application/json" });
}

async function writeCount(page: Page): Promise<string> {
  return (await page.locator("body").getAttribute("data-control-count")) ?? "0";
}

async function waitInputFrames(page: Page): Promise<void> {
  const before = Number(await page.locator("body").getAttribute("data-control-framesright"));
  await expect
    .poll(async () => Number(await page.locator("body").getAttribute("data-control-framesright")))
    .toBeGreaterThan(before + 5);
}

async function preventedArrowStaysQuiet(page: Page): Promise<void> {
  const count = await writeCount(page);
  await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true, bubbles: true });
    event.preventDefault();
    window.dispatchEvent(event);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp", bubbles: true }));
  });
  await waitInputFrames(page);
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await expect(page.locator("body")).toHaveAttribute("data-control-count", count);
}

async function keyupAcrossMenu(page: Page): Promise<void> {
  await page.keyboard.down("ArrowDown");
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await page.getByRole("button", { name: "Geräte verbinden" }).click();
  await page.keyboard.up("ArrowDown");
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hud-gear")).toHaveText("11");
}

test("native Play edges reach acknowledged FTMS simulation through the real worker and visible world", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await connect(page);
  await enable(page);
  await expect(page.locator("body")).toHaveAttribute("data-control-opcodes", /^0,7,17,17/u);
  const initial = await grade(page);
  await page.evaluate(() => document.dispatchEvent(new Event("test-control-right-down")));
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect.poll(() => grade(page)).toBeGreaterThan(initial);
  const higher = await grade(page);
  await waitInputFrames(page);
  await page
    .getByRole("dialog")
    .screenshot({ path: testInfo.outputPath("native-ftms-control.png") });
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("test-control-right-up"));
    document.dispatchEvent(new Event("test-control-left-down"));
  });
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await expect.poll(() => grade(page)).toBeLessThan(higher);
  await page.evaluate(() => document.dispatchEvent(new Event("test-control-left-up")));
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(page.getByLabel("3D ride scene")).toBeVisible();
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Render diagnostics").getAttribute("data-calls")),
    )
    .toBeGreaterThan(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-control-unexpected-write");
  await expect(page.locator("body")).toHaveAttribute("data-control-playleft", "RideOn");
  await expect(page.locator("body")).toHaveAttribute("data-control-playright", "RideOn");
  await page
    .getByLabel("3D ride scene")
    .screenshot({ path: testInfo.outputPath("native-ftms-world.png") });
  await page
    .getByRole("region", { name: "Ride HUD" })
    .screenshot({ path: testInfo.outputPath("native-ftms-hud.png") });
  await saveProtocol(page, testInfo);
  expect(errors).toEqual([]);
});

test("menu/form arrows never shift an enabled trainer, body arrows and physical Play still work", async ({
  page,
}) => {
  await connect(page);
  await enable(page);
  const initial = await grade(page);
  const count = await writeCount(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await waitInputFrames(page);
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await expect.poll(() => grade(page)).toBe(initial);
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.getByTestId("profile-massKg").focus();
  await page.keyboard.press("ArrowUp");
  await waitInputFrames(page);
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await expect.poll(() => grade(page)).toBe(initial);
  await expect(page.locator("body")).toHaveAttribute("data-control-count", count);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await preventedArrowStaysQuiet(page);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect.poll(() => grade(page)).toBeGreaterThan(initial);
  await keyupAcrossMenu(page);
});

test("native accelerated clock refuses authority, zero trainer writes", async ({ page }) => {
  await connect(page, "?clock=fast");
  await page.getByRole("button", { name: "Rollenschaltung aktivieren", exact: true }).click();
  await expect(page.getByLabel("Rollenschaltung Status")).toContainText("Echtzeit");
  await expect(page.locator("body")).not.toHaveAttribute("data-control-count");
});

test("permission loss keeps watts alive and cannot silently reacquire", async ({ page }) => {
  await connect(page);
  await enable(page);
  await page.evaluate(() => document.dispatchEvent(new Event("test-control-permission-lost")));
  await expect(page.getByRole("group", { name: "Rollenschaltung", exact: true })).toHaveAttribute(
    "data-authority",
    "lost",
  );
  const count = await writeCount(page);
  await page.evaluate(() => document.dispatchEvent(new Event("test-control-right-down")));
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await expect(page.getByTestId("hud-power")).toHaveText("244 W");
  await expect(page.locator("body")).toHaveAttribute("data-control-count", count);
  await expect(
    page.getByRole("button", { name: "Rollenschaltung aktivieren", exact: true }),
  ).toBeDisabled();
});

test("native data reconnect clears authority and never replays resistance until another explicit enable", async ({
  page,
}) => {
  await connect(page);
  await enable(page);
  const count = await writeCount(page);

  const row = page
    .getByRole("dialog")
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Trainer", exact: true }) });

  await page.evaluate(() => document.dispatchEvent(new Event("test-control-trainer-disconnect")));
  await expect(row.getByLabel("Trainer Status")).toHaveText("reconnecting");
  await expect(row.getByLabel("Trainer Status")).toHaveText("ready");
  await waitInputFrames(page);
  await expect(page.getByRole("group", { name: "Rollenschaltung", exact: true })).toHaveAttribute(
    "data-authority",
    "inactive",
  );
  await expect(page.getByLabel("Trainer-ACK")).toContainText("Widerstand unbekannt");
  await expect(page.locator("body")).toHaveAttribute("data-control-count", count);
  await expect(page.getByTestId("hud-power")).toHaveText("244 W");
  await enable(page);
  await expect.poll(async () => Number(await writeCount(page))).toBeGreaterThan(Number(count) + 2);
  await expect(page.locator("body")).not.toHaveAttribute("data-control-unexpected-write");
});
