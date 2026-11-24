// oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns mutable Page, Worker and test fixture handles.
import { expect, test, type Page } from "@playwright/test";
import { playBluetoothFakeScript } from "./helpers/playBluetooth.js";

async function choose(page: Page, heading: string): Promise<void> {
  const row = page
    .getByRole("dialog")
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

  await row.getByRole("button", { name: "Gerät wählen" }).click();
  await expect(row.getByLabel(`${heading} Status`)).toHaveText("ready");
}

async function checkShifts(page: Page): Promise<void> {
  const gear = page.getByTestId("hud-gear");
  await expect(gear).toHaveText("12");
  await page.evaluate(() => document.dispatchEvent(new Event("test-play-right-down")));
  await expect(gear).toHaveText("13");
  await expect
    .poll(async () => Number(await page.locator("body").getAttribute("data-play-framesright")))
    .toBeGreaterThan(15);
  await expect(gear).toHaveText("13");
  await page.evaluate(() => document.dispatchEvent(new Event("test-play-right-up")));
  await page.evaluate(() => document.dispatchEvent(new Event("test-play-left-down")));
  await expect(gear).toHaveText("12");
  await expect
    .poll(async () => Number(await page.locator("body").getAttribute("data-play-framesleft")))
    .toBeGreaterThan(30);
  await expect(gear).toHaveText("12");
  await page.evaluate(() => document.dispatchEvent(new Event("test-play-left-up")));
  await page.keyboard.press("ArrowUp");
  await expect(gear).toHaveText("13");
  await page.keyboard.press("ArrowDown");
  await expect(gear).toHaveText("12");
}

test("both native Play adapters shift exactly once through the real worker and WebGL ride", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const workers: string[] = [];
  page.on("pageerror", (error: Readonly<Error>) => {
    errors.push(error.message);
  });
  page.on("worker", (worker) => {
    workers.push(worker.url());
  });
  await page.addInitScript({ content: playBluetoothFakeScript() });
  await page.goto("/?debug=1");
  await page.getByRole("button", { name: "Geräte verbinden" }).click();
  await choose(page, "Trainer");
  await choose(page, "Pulsgurt");
  await choose(page, "Linker Play-Griff");
  await choose(page, "Rechter Play-Griff");
  await expect(page.getByText("Linker Griff bestätigt.", { exact: false })).toBeVisible();
  await expect(page.getByText("Rechter Griff bestätigt.", { exact: false })).toBeVisible();
  await page
    .getByRole("dialog")
    .screenshot({ path: testInfo.outputPath("verified-play-di-connections.png") });
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await checkShifts(page);
  await expect(page.getByTestId("hud-status")).toHaveText("Bluetooth connected");
  await expect(page.getByTestId("hud-power")).toHaveText("244 W", { timeout: 10_000 });
  await expect(page.getByTestId("hud-heart-rate")).toHaveText("132 bpm");
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Render diagnostics").getAttribute("data-calls")),
    )
    .toBeGreaterThan(0);
  await expect(page.getByLabel("3D ride scene")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-play-writesleft", "1");
  await expect(page.locator("body")).toHaveAttribute("data-play-writesright", "1");
  await expect(page.locator("body")).toHaveAttribute("data-play-picker-calls", "4");
  await expect(page.locator("body")).not.toHaveAttribute("data-unexpected-write");
  expect(workers.some((url) => url.includes("engine-worker"))).toBe(true);
  expect(errors).toEqual([]);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: testInfo.outputPath("verified-play-di-worker.png") });
  await page
    .getByRole("region", { name: "Ride HUD" })
    .screenshot({ path: testInfo.outputPath("verified-play-di-hud.png") });
});

test("remembered Play reconnect needs no new picker", async ({ page }) => {
  await page.addInitScript({ content: playBluetoothFakeScript() });
  await page.goto("/");
  await page.getByRole("button", { name: "Geräte verbinden" }).click();

  const left = page
    .getByRole("dialog")
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Linker Play-Griff", exact: true }) });

  await choose(page, "Linker Play-Griff");
  await page.evaluate(() => document.dispatchEvent(new Event("test-play-left-disconnect")));
  await expect(left.getByLabel("Linker Play-Griff Status")).toHaveText("reconnecting");
  await expect(left.getByLabel("Linker Play-Griff Status")).toHaveText("ready");
  await expect(page.locator("body")).toHaveAttribute("data-play-picker-calls", "1");
  await expect(page.locator("body")).toHaveAttribute("data-play-writesleft", "2");
  await expect(page.locator("body")).not.toHaveAttribute("data-unexpected-write");
});

async function rejectedFormerOwner(page: Page) {
  await page.addInitScript({ content: playBluetoothFakeScript() });
  await page.goto("/");
  await page.getByRole("button", { name: "Geräte verbinden" }).click();
  await page.evaluate(() => {
    document.body.dataset["playSelection"] = "right";
  });

  const left = page
    .getByRole("dialog")
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Linker Play-Griff", exact: true }) });

  await left.getByRole("button", { name: "Gerät wählen" }).click();
  await expect(left.getByLabel("Linker Play-Griff Status")).toHaveText("error");
  await expect(left).toContainText("Falscher Griff: rechts erkannt");
  await left.getByRole("button", { name: "Trennen", exact: true }).click();
  await choose(page, "Rechter Play-Griff");
  await left.getByRole("button", { name: "Gerät wählen" }).click();
  await expect(left.getByLabel("Linker Play-Griff Status")).toHaveText("error");
  await left.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(left.getByLabel("Linker Play-Griff Status")).toHaveText("error");
  await expect(page.locator("body")).toHaveAttribute("data-play-picker-calls", "3");

  return left;
}

async function foreignRightStillWorks(page: Page): Promise<void> {
  await expect(page.getByLabel("Rechter Play-Griff Status")).toHaveText("ready");
  await expect(page.locator("body")).toHaveAttribute("data-disconnect-play-right", "1");
  await expect(page.locator("body")).toHaveAttribute("data-play-writesright", "2");
  await page.evaluate(() => document.dispatchEvent(new Event("test-play-right-down")));
  await expect(page.getByTestId("hud-gear")).toHaveText("13");
  await page.evaluate(() => document.dispatchEvent(new Event("test-play-right-up")));
  await expect(page.getByLabel("Rechter Play-Griff Status")).toHaveText("ready");
  await expect(page.locator("body")).not.toHaveAttribute("data-unexpected-write");
}

test("disconnecting a rejected former Play owner leaves the current right controller ready", async ({
  page,
}, testInfo) => {
  const left = await rejectedFormerOwner(page);
  await left.getByRole("button", { name: "Trennen", exact: true }).click();
  await foreignRightStillWorks(page);
  await page
    .getByRole("dialog")
    .screenshot({ path: testInfo.outputPath("foreign-owner-disconnect.png") });
});

test("choosing a replacement after ownership rejection leaves the foreign right controller ready", async ({
  page,
}, testInfo) => {
  await rejectedFormerOwner(page);
  await page.evaluate(() => {
    delete document.body.dataset["playSelection"];
  });
  await choose(page, "Linker Play-Griff");
  await foreignRightStillWorks(page);
  await page
    .getByRole("dialog")
    .screenshot({ path: testInfo.outputPath("foreign-owner-replacement.png") });
});
