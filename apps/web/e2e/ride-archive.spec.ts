import { expect, test } from "@playwright/test";
import {
  archivedRideTrack,
  serializeRideTcx,
  type CapturedRide,
  type CompletedLocalRide,
} from "@voltonaut/shared";

import { localRide } from "../src/sync/testdata/localRide.js";

type LocalCapture = Extract<CapturedRide, { readonly kind: "local_only" }>;

const capture: LocalCapture = {
  kind: "local_only",
  reason: "journal_age",
  track: {
    rideId: localRide.rideId,
    startedAt: localRide.startedAt,
    metadata: localRide.metadata,
    samples: localRide.samples,
  },
};

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page and Route fixtures used to isolate the actual storage adapter.
test.beforeEach(async ({ page }) => {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the response route handle.
  await page.context().route("**/archive-storage.html", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Archive adapter check</title>",
    });
  });
  await page.context().addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", {
      get() {
        throw new Error("Native Bluetooth forbidden in archive checks");
      },
    });
  });
  await page.goto("/archive-storage.html");
});

async function seedHistorical(options: {
  readonly seed: CompletedLocalRide;
  readonly count: number;
}): Promise<string> {
  const { openRideDatabase } = await import("../src/sync/rideDatabase.js");
  await openRideDatabase(indexedDB);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voltonaut-local-rides", 1);
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction("completed", "readwrite");
      const rows: CompletedLocalRide[] = [];

      for (let index = 0; index < options.count; index += 1) {
        const rideId = index === 0 ? options.seed.rideId.toUpperCase() : crypto.randomUUID();
        const row = { ...options.seed, rideId };
        rows.push(row);
        transaction.objectStore("completed").add(row, rideId);
      }

      transaction.addEventListener("complete", () => {
        database.close();
        resolve(JSON.stringify(rows));
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(new Error("Historical seed failed"));
      });
    });
    request.addEventListener("error", () => {
      reject(new Error("Historical open failed"));
    });
  });
}

function readRawArchive(): Promise<string> {
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

async function concurrentSameId(seed: LocalCapture) {
  const { openRideDatabase } = await import("../src/sync/rideDatabase.js");
  const { createRideStore } = await import("../src/sync/rideStore.js");
  const first = createRideStore(await openRideDatabase(indexedDB));
  const second = createRideStore(await openRideDatabase(indexedDB));
  await Promise.all([
    first.save({ ...seed, track: { ...seed.track, rideId: seed.track.rideId.toUpperCase() } }),
    second.save(seed),
  ]);
  let conflict = "";

  try {
    await second.save({ ...seed, reason: "invalid_input" });
  } catch (cause) {
    conflict = cause instanceof Error ? cause.message : "Unexpected archive error";
  }

  return { rows: await first.list(), conflict };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("canonical UUID and immutable local-only rows hold across concurrent database handles", async ({
  page,
}) => {
  const result = await page.evaluate(concurrentSameId, capture);
  expect(result.rows).toEqual([capture]);
  expect(result.conflict).toBe("Fahrt-ID bereits mit anderen Daten vorhanden.");
  const before = await page.evaluate(readRawArchive);
  await page.reload();
  expect(await page.evaluate(readRawArchive)).toBe(before);
});

async function conflictWithHistorical(seed: LocalCapture) {
  const { openRideDatabase } = await import("../src/sync/rideDatabase.js");
  const { createRideStore } = await import("../src/sync/rideStore.js");
  const store = createRideStore(await openRideDatabase(indexedDB));
  let conflict = "";

  try {
    await store.save(seed);
  } catch (cause) {
    conflict = cause instanceof Error ? cause.message : "Unexpected archive error";
  }

  return { rows: await store.list(), conflict };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("historical uppercase raw V1 remains unchanged and cannot be overwritten by another archive form", async ({
  page,
}) => {
  await page.evaluate(seedHistorical, { seed: localRide, count: 1 });
  const before = await page.evaluate(readRawArchive);
  const result = await page.evaluate(conflictWithHistorical, capture);
  expect(result.rows).toEqual([
    { kind: "legacy", recording: { ...localRide, rideId: localRide.rideId.toUpperCase() } },
  ]);
  expect(result.conflict).toBe("Fahrt-ID bereits mit anderen Daten vorhanden.");
  expect(await page.evaluate(readRawArchive)).toBe(before);
  const historical = { ...localRide, rideId: localRide.rideId.toUpperCase() };

  for (const row of result.rows)
    expect(serializeRideTcx(archivedRideTrack(row))).toBe(serializeRideTcx(historical));
});

async function loadArchivedRows() {
  const { openRideDatabase } = await import("../src/sync/rideDatabase.js");
  const { createRideStore } = await import("../src/sync/rideStore.js");

  return createRideStore(await openRideDatabase(indexedDB)).list();
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
test("one atomic capacity covers historical and new local rows across actual tabs", async ({
  page,
}) => {
  await page.evaluate(seedHistorical, { seed: localRide, count: 19 });
  const second = await page.context().newPage();
  await second.goto("/archive-storage.html");

  const firstCapture: LocalCapture = {
    ...capture,
    track: { ...capture.track, rideId: "550e8400-e29b-41d4-a716-446655440002" },
  };

  const secondCapture: LocalCapture = {
    ...capture,
    track: { ...capture.track, rideId: "550e8400-e29b-41d4-a716-446655440003" },
  };

  const results = await Promise.all([
    page.evaluate(tryCaptureSave, firstCapture),
    second.evaluate(tryCaptureSave, secondCapture),
  ]);

  expect(results.filter((result) => result === "saved")).toHaveLength(1);
  expect(results.filter((result) => result.includes("Speicher voll"))).toHaveLength(1);
  const rows = await page.evaluate(loadArchivedRows);
  expect(rows).toHaveLength(20);
  expect(rows.filter((row) => row.kind === "legacy")).toHaveLength(19);
  expect(rows.filter((row) => row.kind === "local_only")).toHaveLength(1);
  await second.close();
});

async function tryCaptureSave(seed: CapturedRide): Promise<string> {
  const { openRideDatabase } = await import("../src/sync/rideDatabase.js");
  const { createRideStore } = await import("../src/sync/rideStore.js");

  try {
    await createRideStore(await openRideDatabase(indexedDB)).save(seed);

    return "saved";
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Unexpected archive error";
  }
}

function failNextArchiveInsert(): void {
  // oxlint-disable-next-line typescript/unbound-method -- Preserve the native method for restoration only; it is never called unbound.
  const add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = () => {
    IDBObjectStore.prototype.add = add;
    throw new DOMException("Injected quota failure", "QuotaExceededError");
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the page fixture and the native IndexedDB fault-injection boundary.
test("an injected quota error aborts the real transaction without uncaught errors or lost historical bytes", async ({
  page,
}) => {
  await page.evaluate(seedHistorical, { seed: localRide, count: 1 });
  const before = await page.evaluate(readRawArchive);
  const errors: string[] = [];
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright supplies its native Error event contract.
  page.on("pageerror", (cause) => {
    errors.push(cause.message);
  });

  const pending: LocalCapture = {
    ...capture,
    track: { ...capture.track, rideId: "550e8400-e29b-41d4-a716-446655440002" },
  };

  await page.evaluate(failNextArchiveInsert);
  expect(await page.evaluate(tryCaptureSave, pending)).toContain(
    "TCX vor dem Schließen herunterladen",
  );
  expect(await page.evaluate(readRawArchive)).toBe(before);
  expect(errors).toEqual([]);
  expect(await page.evaluate(tryCaptureSave, pending)).toBe("saved");
});
