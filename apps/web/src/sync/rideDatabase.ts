import {
  CapturedRideSchema,
  RideRecordingSchema,
  MAX_RECORDING_V2_BYTES,
  MAX_LOCAL_RIDES,
  type ArchivedRide,
  type CapturedRide,
  type RideRecording,
} from "@voltonaut/shared";

import type { RideDatabase } from "./rideStore.js";
import { validateCapture } from "./rideStore.js";

const STORE = "completed";
const StoredRideSchema = RideRecordingSchema.or(CapturedRideSchema);

type DecodedRow =
  | { readonly success: false }
  | { readonly success: true; readonly data: RideRecording | CapturedRide };

function parsedRow(parsed: DecodedRow): ArchivedRide | undefined {
  if (!parsed.success) return undefined;
  const row = parsed.data;

  if ("kind" in row) return row.kind === "local_only" ? row : undefined;

  return row.schemaVersion === 2
    ? { kind: "journal", recording: row }
    : { kind: "legacy", recording: row };
}

function rideId(ride: ArchivedRide): string {
  return (ride.kind === "local_only" ? ride.track.rideId : ride.recording.rideId).toLowerCase();
}

function immutableJson(ride: ArchivedRide): string {
  return JSON.stringify(
    ride.kind === "local_only"
      ? { ...ride, track: { ...ride.track, rideId: rideId(ride) } }
      : { ...ride.recording, rideId: rideId(ride) },
  );
}

type InsertDecision =
  | { readonly kind: "existing" }
  | { readonly kind: "insert" }
  | { readonly kind: "failed"; readonly message: string };

function selectInsert(
  rows: readonly (ArchivedRide | undefined)[],
  ride: CapturedRide,
): InsertDecision {
  const ids = rows.flatMap((row) => (row === undefined ? [] : [rideId(row)]));

  if (
    new Set(ids).size !== rows.length ||
    rows.some(
      (row) =>
        row === undefined ||
        new TextEncoder().encode(immutableJson(row)).byteLength > MAX_RECORDING_V2_BYTES,
    ) ||
    rows.length > MAX_LOCAL_RIDES
  )
    return { kind: "failed", message: "Lokale Fahrten nicht lesbar. Daten bleiben unverändert." };
  const matches = rows.filter((row) => row !== undefined && rideId(row) === rideId(ride));
  const previous = matches[0];

  if (previous !== undefined)
    return matches.length === 1 && immutableJson(previous) === immutableJson(ride)
      ? { kind: "existing" }
      : { kind: "failed", message: "Fahrt-ID bereits mit anderen Daten vorhanden." };

  return rows.length >= MAX_LOCAL_RIDES
    ? {
        kind: "failed",
        message: `Lokaler Speicher voll (${MAX_LOCAL_RIDES} Fahrten). Keine Daten gelöscht. TCX jetzt herunterladen.`,
      }
    : { kind: "insert" };
}

function listRides(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM database owns transaction lifecycle.
  database: IDBDatabase,
): Promise<readonly ArchivedRide[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll(undefined, MAX_LOCAL_RIDES + 1);
    const rides: ArchivedRide[] = [];
    const ids = new Set<string>();

    request.addEventListener("success", () => {
      const rows: readonly unknown[] = request.result;

      if (rows.length > MAX_LOCAL_RIDES) {
        transaction.abort();

        return;
      }

      for (const row of rows) {
        const parsed = parsedRow(StoredRideSchema.safeParse(row));

        if (
          parsed === undefined ||
          ids.has(rideId(parsed)) ||
          new TextEncoder().encode(immutableJson(parsed)).byteLength > MAX_RECORDING_V2_BYTES
        ) {
          transaction.abort();

          return;
        }

        ids.add(rideId(parsed));
        rides.push(parsed);
      }
    });
    transaction.addEventListener("complete", () => {
      resolve(rides);
    });
    transaction.addEventListener("abort", () => {
      reject(new Error("Lokale Fahrten nicht lesbar. Daten bleiben unverändert."));
    });
    transaction.addEventListener("error", () => {
      reject(new Error("Lokale Fahrten konnten nicht geladen werden."));
    });
  });
}

function insertRide(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM database owns transaction lifecycle.
  database: IDBDatabase,
  capture: CapturedRide,
): Promise<void> {
  const ride = validateCapture(capture);

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const existing = store.getAll(undefined, MAX_LOCAL_RIDES + 1);
    let failure = "Speichern fehlgeschlagen. TCX vor dem Schließen herunterladen.";

    existing.addEventListener("success", () => {
      const raw: readonly unknown[] = existing.result;
      const rows = raw.map((row) => parsedRow(StoredRideSchema.safeParse(row)));
      const decision = selectInsert(rows, ride);

      if (decision.kind === "failed") {
        failure = decision.message;
        transaction.abort();

        return;
      }

      if (decision.kind === "existing") return;

      try {
        store.add(ride.kind === "journal" ? ride.recording : ride, rideId(ride));
      } catch {
        transaction.abort();
      }
    });
    transaction.addEventListener("complete", () => {
      resolve();
    });
    transaction.addEventListener("abort", () => {
      reject(new Error(failure));
    });
    transaction.addEventListener("error", () => {
      reject(new Error(failure));
    });
  });
}

export function openRideDatabase(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Browser-owned factory is injected for the DOM boundary.
  factory: IDBFactory,
): Promise<RideDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open("voltonaut-local-rides", 1);
    let blocked = false;

    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE);
    });
    request.addEventListener("success", () => {
      if (blocked) {
        request.result.close();

        return;
      }

      const database = request.result;
      database.addEventListener("versionchange", () => {
        database.close();
      });
      resolve({ list: () => listRides(database), insert: (ride) => insertRide(database, ride) });
    });
    request.addEventListener("error", () => {
      reject(new Error("Lokaler Fahrtspeicher nicht verfügbar."));
    });
    request.addEventListener("blocked", () => {
      blocked = true;
      reject(new Error("Lokaler Fahrtspeicher blockiert. Andere Tabs schließen und neu laden."));
    });
  });
}
