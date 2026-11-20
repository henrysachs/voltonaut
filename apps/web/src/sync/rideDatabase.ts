import {
  CompletedLocalRideSchema,
  MAX_LOCAL_RIDES,
  type CompletedLocalRide,
} from "@voltonaut/shared";

import type { RideDatabase } from "./rideStore.js";

const STORE = "completed";

function listRides(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM database owns transaction lifecycle.
  database: IDBDatabase,
): Promise<readonly CompletedLocalRide[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll(undefined, MAX_LOCAL_RIDES + 1);
    const rides: CompletedLocalRide[] = [];

    request.addEventListener("success", () => {
      const rows: readonly unknown[] = request.result;

      if (rows.length > MAX_LOCAL_RIDES) {
        transaction.abort();

        return;
      }

      for (const row of rows) {
        const parsed = CompletedLocalRideSchema.safeParse(row);

        if (!parsed.success) {
          transaction.abort();

          return;
        }

        rides.push(parsed.data);
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
  ride: CompletedLocalRide,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const existing = store.get(ride.rideId);
    const count = store.count();
    let failure = "Speichern fehlgeschlagen. TCX vor dem Schließen herunterladen.";

    count.addEventListener("success", () => {
      const raw: unknown = existing.result;

      if (raw !== undefined) {
        const parsed = CompletedLocalRideSchema.safeParse(raw);

        if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(ride)) {
          failure = "Fahrt-ID bereits mit anderen Daten vorhanden.";
          transaction.abort();
        }

        return;
      }

      if (count.result >= MAX_LOCAL_RIDES) {
        failure = `Lokaler Speicher voll (${MAX_LOCAL_RIDES} Fahrten). Keine Daten gelöscht. TCX jetzt herunterladen.`;
        transaction.abort();

        return;
      }

      store.add(ride, ride.rideId);
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
