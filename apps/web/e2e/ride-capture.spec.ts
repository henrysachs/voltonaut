/// <reference types="node" />
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  projectRecordingTrack,
  RecordingV2Schema,
  serializeRideTcx,
  type RecordingV2,
} from "@voltonaut/shared";

function readCaptureRows(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voltonaut-local-rides", 1);
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction("completed", "readonly");
      const rows = transaction.objectStore("completed").getAll();
      transaction.addEventListener("complete", () => {
        database.close();
        resolve(JSON.stringify(rows.result));
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(new Error("Archive read failed"));
      });
    });
    request.addEventListener("error", () => {
      reject(new Error("Archive open failed"));
    });
  });
}

function firstRecording(json: string): RecordingV2 {
  const first = RecordingV2Schema.array().length(1).parse(JSON.parse(json))[0];

  if (first === undefined) throw new Error("First actual capture missing");

  return first;
}

function secondRecording(json: string, previous: RecordingV2): RecordingV2 {
  const rows = RecordingV2Schema.array().length(2).parse(JSON.parse(json));
  const storedPrevious = rows.find((row) => row.rideId === previous.rideId);
  expect(storedPrevious).toEqual(previous);
  const second = rows.find((row) => row.rideId !== previous.rideId);

  if (second === undefined) throw new Error("Second actual capture missing");

  return second;
}

function assertFullPrefix(first: RecordingV2, second: RecordingV2): void {
  const firstPhysics = first.entries
    .filter((entry) => entry[2] !== "boundary")
    .map((entry) => entry.slice(1));

  const secondPhysics = second.entries
    .filter((entry) => entry[2] !== "boundary")
    .map((entry) => entry.slice(1));

  expect(secondPhysics.slice(0, firstPhysics.length)).toEqual(firstPhysics);
  expect(secondPhysics.length).toBeGreaterThan(firstPhysics.length);
  expect(
    second.entries
      .filter((entry) => entry[2] === "boundary")
      .filter((entry) => entry[3] === "start"),
  ).toHaveLength(1);
  expect(
    second.entries
      .filter((entry) => entry[2] === "boundary")
      .filter((entry) => entry[3] === "finish"),
  ).toHaveLength(1);
  expect(second.observations[0]?.snapshot.distanceM).toBeGreaterThan(
    first.observations.at(-1)?.snapshot.distanceM ?? 0,
  );
  const track = projectRecordingTrack(second);
  expect(track.samples[0]).toMatchObject({ elapsedMs: 0, distanceM: 0 });
  expect(track.samples.at(-1)?.elapsedMs).toBeGreaterThanOrEqual(1000);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page control boundary.
async function captureThroughUi(page: Readonly<Page>): Promise<void> {
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page and Download artifact lifecycle.
async function downloadTcx(page: Readonly<Page>, filename: string): Promise<string> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "TCX herunterladen", exact: true }).first().click();
  const path = test.info().outputPath(filename);
  await (await pending).saveAs(path);

  return readFile(path, "utf8");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page event source; evidence records only paths and error messages.
function observeCapture(page: Readonly<Page>) {
  const requests: string[] = [];
  const workers: string[] = [];
  const errors: string[] = [];
  page.on("request", (request: { readonly url: () => string }) => {
    requests.push(new URL(request.url()).pathname);
  });
  page.on("worker", (worker: { readonly url: () => string }) => {
    workers.push(new URL(worker.url()).pathname);
  });
  page.on("pageerror", (cause: { readonly message: string }) => {
    errors.push(cause.message);
  });

  return { requests, workers, errors };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture and native dialog/download handles.
test("public controls keep full worker prefixes across saved and discarded windows, with identical TCX after reload", async ({
  page,
}) => {
  const evidence = observeCapture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", {
      get() {
        throw new Error("Native Bluetooth forbidden in recording Sim check");
      },
    });
  });
  await page.goto("/?sim=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.getByTestId("hud-speed")).not.toHaveText("0.0 km/h");
  const start = page.getByRole("button", { name: "Aufnahme starten", exact: true });
  const status = page.getByTestId("recording-status");
  await captureThroughUi(page);
  const first = firstRecording(await page.evaluate(readCaptureRows));
  await start.click();
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright supplies the native confirmation dialog.
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Laufende Aufnahme verwerfen", exact: true }).click();
  await expect(status).toContainText("verworfen");
  await captureThroughUi(page);
  const raw = await page.evaluate(readCaptureRows);
  const second = secondRecording(raw, first);
  assertFullPrefix(first, second);
  await writeFile(test.info().outputPath("actual-worker-archives.json"), raw, "utf8");
  await page.screenshot({
    path: test.info().outputPath("second-window-saved.png"),
    fullPage: true,
  });
  const xml = await downloadTcx(page, "worker-capture.tcx");
  expect(xml).toBe(serializeRideTcx(projectRecordingTrack(second)));
  await page.reload();
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toHaveCount(2);
  expect(await page.evaluate(readCaptureRows)).toBe(raw);
  expect(await downloadTcx(page, "worker-capture-reloaded.tcx")).toBe(xml);
  await page.screenshot({
    path: test.info().outputPath("second-window-reloaded.png"),
    fullPage: true,
  });
  await writeFile(test.info().outputPath("actual-browser.json"), JSON.stringify(evidence), "utf8");
  expect(evidence.errors).toEqual([]);
});
