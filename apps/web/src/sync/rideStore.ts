import {
  CapturedRideSchema,
  MAX_RECORDING_V2_BYTES,
  type ArchivedRide,
  type CapturedRide,
} from "@voltonaut/shared";

export interface RideDatabase {
  readonly list: () => Promise<readonly ArchivedRide[]>;
  /** Atomic insert, with capacity and immutable-ID checks inside the database transaction. */
  readonly insert: (ride: CapturedRide) => Promise<void>;
}

export interface RideStore {
  readonly list: () => Promise<readonly ArchivedRide[]>;
  readonly save: (ride: CapturedRide) => Promise<void>;
}

export function validateCapture(ride: CapturedRide): CapturedRide {
  const parsed = CapturedRideSchema.safeParse(ride);

  if (!parsed.success) {
    throw new Error("Aufnahme ungültig. Nicht gespeichert.");
  }

  const capture = parsed.data;
  const row = capture.kind === "journal" ? capture.recording : capture;

  if (new TextEncoder().encode(JSON.stringify(row)).byteLength > MAX_RECORDING_V2_BYTES)
    throw new Error("Aufnahme ungültig. Nicht gespeichert.");

  return capture.kind === "journal"
    ? {
        kind: "journal",
        recording: { ...capture.recording, rideId: capture.recording.rideId.toLowerCase() },
      }
    : { ...capture, track: { ...capture.track, rideId: capture.track.rideId.toLowerCase() } };
}

export function createRideStore(database: RideDatabase): RideStore {
  return {
    list: () => database.list(),
    async save(ride) {
      await database.insert(validateCapture(ride));
    },
  };
}
