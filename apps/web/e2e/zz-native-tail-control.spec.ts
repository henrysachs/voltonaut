/// <reference types="node" />
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import process from "node:process";
import { openGameMenu } from "./helpers/gameMenu.js";
import { reportMenuFailure } from "./helpers/menuFailure.js";
import type { FirstDrawPoll } from "./helpers/menuFailure.js";
import { startNativeCapture } from "./helpers/nativeFirstFrame.js";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the page and test information used by the unchanged original workload.
async function runMenuCase(page: Page, testInfo: TestInfo): Promise<void> {
  let firstDrawPoll: FirstDrawPoll = { kind: "not-polled" };

  try {
    await page.goto("/?sim=1&debug=1");
    const diagnostics = page.getByLabel("Render diagnostics");
    await expect
      .poll(async () => {
        const rawCalls = await diagnostics.getAttribute("data-calls");
        firstDrawPoll = { kind: "polled", rawCalls };

        return Number(rawCalls);
      })
      .toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("desktop-ride.png") });
    await openGameMenu(page, "Profil");
    const distanceM = Number(await diagnostics.getAttribute("data-distance-m"));
    const hudDistance = await page.getByTestId("hud-distance").textContent();
    await expect
      .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
      .toBeGreaterThan(distanceM + 8);
    await expect(page.getByTestId("hud-distance")).not.toHaveText(String(hudDistance));
    const calls = Number(await diagnostics.getAttribute("data-calls"));
    const triangles = Number(await diagnostics.getAttribute("data-triangles"));
    expect(calls).toBeLessThanOrEqual(150);
    expect(triangles).toBeLessThanOrEqual(500_000);
    await testInfo.attach("menu-render-budget.json", {
      body: JSON.stringify({
        calls,
        triangles,
        distanceM,
        movedDistanceM: Number(await diagnostics.getAttribute("data-distance-m")),
      }),
      contentType: "application/json",
    });
    await expect(page.locator("#ride-scene")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".hud")).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("desktop-menu.png") });
  } catch (error) {
    await reportMenuFailure(page, firstDrawPoll).catch(() => null);
    throw error;
  }
}

async function retainControlImage(
  page: Readonly<Pick<Page, "screenshot">>,
  testInfo: Readonly<Pick<TestInfo, "outputPath">>,
): Promise<void> {
  const firstDrawImage = await readFile(testInfo.outputPath("desktop-ride.png")).catch(() => null);

  const image =
    firstDrawImage ??
    (await page
      .screenshot({ path: testInfo.outputPath("failure-retained.png") })
      .catch(() => null));

  if (image === null) return;
  process.stderr.write(
    `${JSON.stringify({
      event: "native-tail-control-first-draw-image",
      observation:
        firstDrawImage === null
          ? "after-failure-and-native-trace"
          : "original-body-screenshot-after-unchanged-first-draw-poll",
      sha256: createHash("sha256").update(image).digest("hex"),
      bytes: image.byteLength,
      pngBase64: image.byteLength <= 128_000 ? image.toString("base64") : null,
    })}\n`,
  );
}

const title = "cold original menu workload at suite tail, not a repair";

function requireOrigin(value: string | undefined): string {
  if (value === undefined) throw new Error("Control requires the unchanged E2E origin");

  return value;
}

async function verifyNativeBuild(): Promise<void> {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

  execFileSync("mise", ["run", "build"], { cwd: root, stdio: "inherit" });
  const files = await readdir(`${root}/apps/web/dist/assets`);
  const workers = files.filter((file) => file.includes("worker") && file.endsWith(".js"));

  const bundles = await Promise.all(
    workers.map(async (file) => ({
      file,
      sha256: createHash("sha256")
        .update(await readFile(`${root}/apps/web/dist/assets/${file}`))
        .digest("hex"),
    })),
  );

  process.stderr.write(
    `${JSON.stringify({
      event: "native-build-verification",
      architecture: process.arch,
      checkoutSha: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      workerBundles: bundles,
    })}\n`,
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns its browser factory and test information fixtures.
test(title, async ({ playwright, baseURL }, testInfo) => {
  const origin = requireOrigin(baseURL);
  process.stderr.write(
    `${JSON.stringify({ event: "native-tail-control-start", freshBrowserProcess: true })}\n`,
  );
  const browser = await playwright.chromium.launch();

  try {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    const stopCapture = await startNativeCapture(page, testInfo);

    try {
      await runMenuCase(page, testInfo);
    } finally {
      await stopCapture();
      await retainControlImage(page, testInfo);
    }
  } finally {
    await browser.close();
  }

  await verifyNativeBuild();
});
