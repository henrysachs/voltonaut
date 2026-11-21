import { DEFAULT_RIDER_PROFILE } from "../profile.js";
import { RecordingV2Schema, type RecordingV2, type ReplayObservationV2 } from "../recordingV2.js";

export function recordingObservation(
  boundarySeq: number,
  distanceM: number,
  tS: number,
): ReplayObservationV2 {
  return {
    boundarySeq,
    snapshot: {
      tS,
      distanceM,
      routePosM: distanceM,
      lap: 0,
      speedMps: 3,
      powerW: 180,
      cadenceRpm: 91,
      hrBpm: 129,
      gradePct: 0,
      gearIndex: 11,
      gearRatio: 2.3,
      elevationGainM: 0,
      energyKj: tS * 0.2,
      paused: false,
      dataAgeS: 0,
    },
    events: [],
    commands: [],
    gap: false,
  };
}

export function recordedRide(): RecordingV2 {
  return RecordingV2Schema.parse({
    schemaVersion: 2,
    rideId: "12345678-1234-4234-8234-123456789abc",
    initializedAt: "2026-11-20T12:00:00.000Z",
    initialization: {
      physicsRevision: "engine-v1",
      routeId: "test-loop",
      routeRevision: "1",
      profile: DEFAULT_RIDER_PROFILE,
      source: "ble",
      clockScale: 1,
      workerTimeOriginMs: Date.parse("2026-11-20T12:00:00.000Z") - 1000,
      initializedWorkerMs: 1000,
    },
    journalState: "complete",
    entries: [
      [0, 1000, "arm"],
      [1, 1000, "status", "trainer", "ready"],
      [2, 1500, "trainer", 200, 90, null],
      [3, 1500, "hr", 130],
      [4, 2000, "advance", 1],
      [5, 2000, "boundary", "start"],
      [6, 2250, "trainer", null, 92, null],
      [7, 3000, "advance", 1],
      [8, 3000, "boundary", "sample"],
      [9, 3500, "trainer", 0, null, null],
      [10, 4000, "advance", 1],
      [11, 4000, "boundary", "finish"],
    ],
    window: { startSeq: 5, finishSeq: 11 },
    observations: [
      recordingObservation(5, 100, 1),
      recordingObservation(8, 103, 2),
      recordingObservation(11, 106, 3),
    ],
  });
}
