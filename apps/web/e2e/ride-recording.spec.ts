import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { MAX_LOCAL_RIDE_MS, type CompletedLocalRide } from "@voltonaut/shared";

import { localRide } from "../src/sync/testdata/localRide.js";

async function downloadText(download: Readonly<Download>): Promise<string> {
  const path = await download.path();

  if (path === null) {
    throw new Error("Download has no local artifact");
  }

  return readFile(path, "utf8");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page contract; this helper only reads and evaluates XML.
async function assertTcxSemantics(page: Readonly<Page>, xml: string): Promise<void> {
  const semantics = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "application/xml");

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- XML DOM nodes are read-only here, but use the browser's Element contract.
    const times = [...doc.querySelectorAll("Trackpoint Time")].map((element) =>
      Date.parse(element.textContent ?? ""),
    );

    return {
      errors: doc.querySelectorAll("parsererror").length,
      sport: doc.querySelector("Activity")?.getAttribute("Sport"),
      times,
      totalS: Number(doc.querySelector("TotalTimeSeconds")?.textContent),
      distanceM: Number(doc.querySelector("Lap > DistanceMeters")?.textContent),
      gps: doc.querySelectorAll("Position, LatitudeDegrees, LongitudeDegrees, AltitudeMeters")
        .length,
      watts: doc.getElementsByTagNameNS(
        "http://www.garmin.com/xmlschemas/ActivityExtension/v2",
        "Watts",
      ).length,
      notes: doc.querySelector("Notes")?.textContent,
    };
  }, xml);

  expect(semantics.errors).toBe(0);
  expect(semantics.sport).toBe("Biking");
  expect(semantics.totalS).toBeGreaterThanOrEqual(2);
  expect(semantics.totalS).toBeLessThan(15);
  expect(semantics.distanceM).toBeGreaterThan(0);
  expect(semantics.times.length).toBeGreaterThanOrEqual(3);

  for (const [index, time] of semantics.times.entries()) {
    expect(time).toBeGreaterThan(semantics.times[index - 1] ?? Number.NEGATIVE_INFINITY);
  }

  expect(semantics.gps).toBe(0);
  expect(semantics.watts).toBeGreaterThan(0);
  expect(semantics.notes).toContain("Voltonaut simulation, not a real workout");
}

function seedFullArchive(seed: CompletedLocalRide): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("voltonaut-local-rides", 1);
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction("completed", "readwrite");

      for (let index = 0; index < 20; index += 1) {
        const rideId = crypto.randomUUID();
        transaction.objectStore("completed").add({ ...seed, rideId }, rideId);
      }

      transaction.addEventListener("complete", () => {
        database.close();
        resolve();
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(new Error("seed failed"));
      });
    });
    request.addEventListener("error", () => {
      reject(new Error("open failed"));
    });
  });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and testInfo fixtures.
test("records real time, explicitly downloads TCX and reloads the same saved bytes", async ({
  page,
}) => {
  await page.goto("/?sim=1&clock=fast");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const status = page.getByTestId("recording-status");
  const start = page.getByRole("button", { name: "Aufnahme starten", exact: true });
  const finish = page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true });
  const exportButton = page.getByRole("button", { name: "TCX herunterladen", exact: true });
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });
  await expect(exportButton).toHaveCount(0);
  await start.click();
  await expect(start).toBeDisabled();
  await page.waitForTimeout(2200);
  await finish.click();
  await expect(status).toContainText("Lokal gespeichert");
  await expect(finish).toBeDisabled();
  expect(downloadCount).toBe(0);
  const firstDownload = page.waitForEvent("download");
  await exportButton.click();
  const artifact = await firstDownload;
  expect(artifact.suggestedFilename()).toMatch(/^voltonaut-sim-.*\.tcx$/u);
  await artifact.saveAs(test.info().outputPath("recorded-sim.tcx"));
  const xml = await downloadText(artifact);
  await assertTcxSemantics(page, xml);
  const secondDownload = page.waitForEvent("download");
  await exportButton.click();
  expect(await downloadText(await secondDownload)).toBe(xml);

  await page.reload();
  await expect(exportButton).toHaveCount(1);
  const reloadedDownload = page.waitForEvent("download");
  await exportButton.click();
  expect(await downloadText(await reloadedDownload)).toBe(xml);
  await start.click();
  await page.waitForTimeout(1100);
  await finish.click();
  await expect(status).toContainText("Lokal gespeichert");
  await expect(exportButton).toHaveCount(2);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("rejects an empty capture without creating a saved ride", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hud-gear")).toHaveText("12");
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("leer oder ungültig");
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toHaveCount(0);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("full local storage preserves existing rides and offers the unsaved download", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await page.evaluate(seedFullArchive, localRide);
  await page.reload();
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toHaveCount(
    20,
  );
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Speicher voll (20 Fahrten)");
  await expect(page.getByRole("button", { name: "Aufnahme starten", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Laufende Aufnahme verwerfen", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toHaveCount(
    21,
  );
  await expect(
    page.getByRole("button", { name: "Speichern erneut versuchen", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Speichern erneut versuchen", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Speicher voll (20 Fahrten)");
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toHaveCount(
    21,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toHaveCount(
    20,
  );
});

async function exerciseRideDatabase(seed: CompletedLocalRide) {
  const { openRideDatabase } = await import("../src/sync/rideDatabase.js");
  const { createRideStore } = await import("../src/sync/rideStore.js");
  const store = createRideStore(await openRideDatabase(indexedDB));
  await store.save(seed);
  await store.save(seed);
  let conflict = "";

  try {
    await store.save({ ...seed, metadata: { ...seed.metadata, routeRevision: "other" } });
  } catch (error) {
    conflict = error instanceof Error ? error.message : "unexpected failure";
  }

  return { rides: await store.list(), conflict };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("the actual IndexedDB adapter is idempotent and rejects a conflicting ride ID", async ({
  page,
}) => {
  await page.goto("/?sim=1");
  const result = await page.evaluate(exerciseRideDatabase, localRide);
  expect(result.rides).toEqual([localRide]);
  expect(result.conflict).toBe("Fahrt-ID bereits mit anderen Daten vorhanden.");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page contract.
function respondToNextConfirmation(page: Readonly<Page>, response: "accept" | "dismiss"): void {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the native browser Dialog contract.
  page.once("dialog", (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("Ungespeicherte Aufnahme wirklich verwerfen?");
    void dialog[response]();
  });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("confirmation recovers an overlong recording without reload or loss of saved rides", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  const start = page.getByRole("button", { name: "Aufnahme starten", exact: true });
  const finish = page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true });
  const discard = page.getByRole("button", { name: "Laufende Aufnahme verwerfen", exact: true });
  const exports = page.getByRole("button", { name: "TCX herunterladen", exact: true });
  const status = page.getByTestId("recording-status");
  await start.click();
  await page.clock.fastForward(1200);
  await finish.click();
  await expect(status).toContainText("Lokal gespeichert");
  const originalDownload = page.waitForEvent("download");
  await exports.click();
  const savedXml = await downloadText(await originalDownload);
  await start.click();
  await page.clock.fastForward(MAX_LOCAL_RIDE_MS + 1);
  await finish.click();
  await expect(status).toContainText("Maximal 6 Stunden");
  respondToNextConfirmation(page, "dismiss");
  await discard.click();
  await expect(start).toBeDisabled();
  await expect(finish).toBeEnabled();
  respondToNextConfirmation(page, "accept");
  await discard.click();
  await expect(status).toContainText("verworfen");
  await expect(start).toBeEnabled();
  await expect(finish).toBeDisabled();
  await expect(discard).toBeDisabled();
  await expect(exports).toHaveCount(1);
  const preservedDownload = page.waitForEvent("download");
  await exports.click();
  expect(await downloadText(await preservedDownload)).toBe(savedXml);
  await start.click();
  await page.clock.fastForward(1200);
  await finish.click();
  await expect(status).toContainText("Lokal gespeichert");
  await expect(exports).toHaveCount(2);
  await expect(discard).toBeDisabled();
});
