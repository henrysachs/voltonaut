import { DEFAULT_RIDER_PROFILE, RecordingV2Schema } from "@voltonaut/shared";

const snapshot = {
  tS: 0,
  distanceM: 0,
  routePosM: 0,
  lap: 0,
  speedMps: 0,
  powerW: 0,
  cadenceRpm: 0,
  hrBpm: null,
  gradePct: 0,
  gearIndex: 0,
  gearRatio: 1,
  elevationGainM: 0,
  energyKj: 0,
  paused: false,
  dataAgeS: 0,
};

export const journalRide = RecordingV2Schema.parse({
  schemaVersion: 2,
  rideId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  initializedAt: "2026-11-20T12:00:00.000Z",
  initialization: {
    physicsRevision: "engine-v1",
    worldId: "test-loop",
    worldRevision: "1",
    pathId: "test-loop",
    profile: DEFAULT_RIDER_PROFILE,
    source: "ble",
    clockScale: 1,
    workerTimeOriginMs: 1795176000000,
    initializedWorkerMs: 0,
  },
  journalState: "complete",
  entries: [
    [0, 0, "arm"],
    [1, 0, "status", "trainer", "ready"],
    [2, 0, "trainer", 250, 90, null],
    [3, 0, "boundary", "start"],
    [4, 1000, "advance", 1],
    [5, 1000, "boundary", "finish"],
  ],
  window: { startSeq: 3, finishSeq: 5 },
  observations: [
    { boundarySeq: 3, snapshot, events: [], commands: [], gap: false },
    {
      boundarySeq: 5,
      snapshot: { ...snapshot, tS: 1, distanceM: 1, routePosM: 1 },
      events: [],
      commands: [],
      gap: false,
    },
  ],
});
