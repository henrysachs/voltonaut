import { expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE } from "./profile.js";
import { RecordingV2Schema } from "./recordingV2.js";

function journal() {
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
    gearIndex: 11,
    gearRatio: 2.3,
    elevationGainM: 0,
    energyKj: 0,
    paused: false,
    dataAgeS: 0,
  };

  return {
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
      workerTimeOriginMs: 1795176000000,
      initializedWorkerMs: 0,
    },
    journalState: "complete",
    entries: [
      [0, 0, "arm"],
      [1, 0, "boundary", "start"],
      [2, 1000, "advance", 1],
      [3, 1000, "boundary", "sample"],
      [4, 1000, "boundary", "finish"],
    ],
    window: { startSeq: 1, finishSeq: 4 },
    observations: [
      { boundarySeq: 1, snapshot, events: [], commands: [], gap: false },
      { boundarySeq: 3, snapshot, events: [], commands: [], gap: false },
      { boundarySeq: 4, snapshot, events: [], commands: [], gap: false },
    ],
  };
}

it("orders coincident sample and finish boundaries by sequence without inventing time", () => {
  const recording = journal();
  const parsed = RecordingV2Schema.parse(recording);

  expect(parsed.entries).toEqual(recording.entries);
  expect(parsed.observations.map((observation) => observation.boundarySeq)).toEqual([1, 3, 4]);
});

it("still rejects a backwards finish or a zero-duration window", () => {
  const recording = journal();

  expect(
    RecordingV2Schema.safeParse({
      ...recording,
      entries: [...recording.entries.slice(0, -1), [4, 999, "boundary", "finish"]],
    }).success,
  ).toBe(false);
  expect(
    RecordingV2Schema.safeParse({
      ...recording,
      entries: [
        [0, 0, "arm"],
        [1, 1000, "advance", 1],
        [2, 1000, "boundary", "start"],
        [3, 1000, "boundary", "finish"],
      ],
      window: { startSeq: 2, finishSeq: 3 },
      observations: [
        { ...recording.observations[0], boundarySeq: 2 },
        { ...recording.observations[0], boundarySeq: 3 },
      ],
    }).success,
  ).toBe(false);
});
