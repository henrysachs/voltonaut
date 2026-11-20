import { expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE } from "./profile.js";
import { CompletedLocalRideSchema } from "./localRide.js";
import {
  MAX_RECORDING_V2_BYTES,
  RecordingEntryV2Schema,
  RecordingV2Schema,
  parseRecordingV2Json,
  recordingV2EntryLimit,
  MAX_RECORDING_V2_ADVANCES,
  MAX_RECORDING_V2_INPUTS,
  type RecordingEntryV2,
} from "./recordingV2.js";

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

function envelope() {
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
      [3, 1000, "boundary", "finish"],
    ],
    window: { startSeq: 1, finishSeq: 3 },
    observations: [
      { boundarySeq: 1, snapshot, events: [], commands: [], gap: false },
      { boundarySeq: 3, snapshot, events: [], commands: [], gap: false },
    ],
  };
}

it("roundtrips V1 without migration or UUID normalization", () => {
  const ride = {
    schemaVersion: 1,
    rideId: "ABCDEF12-1234-4234-8234-123456789ABC",
    startedAt: "2026-11-20T12:00:00.000Z",
    metadata: {
      source: "sim",
      routeId: "test-loop",
      routeRevision: "1",
      physicsClockScale: 20,
      profile: DEFAULT_RIDER_PROFILE,
    },
    samples: [
      { elapsedMs: 0, distanceM: 0, powerW: 0, cadenceRpm: 0, gap: false },
      { elapsedMs: 1000, distanceM: 1, powerW: 250, cadenceRpm: 90, gap: false },
    ],
  };

  expect(JSON.stringify(CompletedLocalRideSchema.parse(ride))).toBe(JSON.stringify(ride));
});

it("keeps absent trainer fields distinct from zero and rejects extra tuple slots", () => {
  expect(RecordingEntryV2Schema.parse([0, 0, "trainer", null, 0, null])).toEqual([
    0,
    0,
    "trainer",
    null,
    0,
    null,
  ]);

  for (const entry of [
    [0, 0, "trainer", undefined, 0, null],
    [0, 0, "reset"],
    [0, 0, "arm", 0],
    [0, 0, "advance", Number.NaN],
    [0, 0, "trainer", Number.POSITIVE_INFINITY, 90, null],
  ]) {
    expect(RecordingEntryV2Schema.safeParse(entry).success).toBe(false);
  }
});

it("requires strict nested fields and complete frozen initial profile", () => {
  expect(RecordingV2Schema.safeParse(envelope()).success).toBe(true);
  expect(RecordingV2Schema.safeParse({ ...envelope(), extra: true }).success).toBe(false);
  const ride = envelope();
  expect(
    RecordingV2Schema.safeParse({
      ...ride,
      initialization: {
        ...ride.initialization,
        initialSpeedMps: 10,
      },
    }).success,
  ).toBe(false);
  expect(
    RecordingV2Schema.safeParse({
      ...ride,
      initialization: {
        ...ride.initialization,
        profile: {
          ...DEFAULT_RIDER_PROFILE,
          bike: {
            ...DEFAULT_RIDER_PROFILE.bike,
            extra: true,
          },
        },
      },
    }).success,
  ).toBe(false);
});

it.each([
  [
    [0, 0, "arm"],
    [2, 0, "boundary", "start"],
    [2, 1000, "advance", 1],
    [3, 1000, "boundary", "finish"],
  ],
  [
    [0, 0, "arm"],
    [1, 0, "boundary", "start"],
    [2, 1000, "advance", 0.999999999],
    [3, 1000, "boundary", "finish"],
  ],
  [
    [0, 0, "arm"],
    [1, 1, "boundary", "start"],
    [2, 0, "advance", 0],
    [3, 1001, "boundary", "finish"],
  ],
  [
    [0, 0, "boundary", "start"],
    [1, 1000, "advance", 1],
    [2, 1000, "boundary", "finish"],
  ],
  [
    [0, 0, "arm"],
    [1, 0, "boundary", "start"],
    [2, 21_600_001, "advance", 21600.001],
    [3, 21_600_001, "boundary", "finish"],
  ],
])(
  "rejects sequence, exact wake-time or duration violations",
  (...entries: readonly (readonly (number | string)[])[]) => {
    expect(RecordingV2Schema.safeParse({ ...envelope(), entries }).success).toBe(false);
  },
);

it("rejects missing, duplicate and reordered boundary references", () => {
  const ride = envelope();
  expect(RecordingV2Schema.safeParse({ ...ride, observations: [] }).success).toBe(false);
  expect(
    RecordingV2Schema.safeParse({ ...ride, observations: ride.observations.toReversed() }).success,
  ).toBe(false);
  expect(
    RecordingV2Schema.safeParse({ ...ride, window: { startSeq: 0, finishSeq: 3 } }).success,
  ).toBe(false);
  expect(
    RecordingV2Schema.safeParse({
      ...ride,
      observations: [...ride.observations, ride.observations[0]],
    }).success,
  ).toBe(false);
});

it("bounds bytes before parsing, including UTF-8 rather than code units", () => {
  expect(parseRecordingV2Json(" ".repeat(MAX_RECORDING_V2_BYTES + 1))).toEqual({
    status: "invalid",
    reason: "bytes",
  });
  expect(parseRecordingV2Json("é".repeat(MAX_RECORDING_V2_BYTES / 2 + 1))).toEqual({
    status: "invalid",
    reason: "bytes",
  });
  expect(parseRecordingV2Json("{")).toEqual({ status: "invalid", reason: "json" });
  expect(parseRecordingV2Json("{}")).toEqual({ status: "invalid", reason: "contract" });
  expect(parseRecordingV2Json(JSON.stringify(envelope())).status).toBe("parsed");
});

it("enforces concurrent operation counts with an incremental count-only scan", () => {
  const advances: RecordingEntryV2[] = Array.from({ length: MAX_RECORDING_V2_ADVANCES }, () => [
    0,
    0,
    "advance",
    0,
  ]);

  const inputs: RecordingEntryV2[] = Array.from({ length: MAX_RECORDING_V2_INPUTS }, () => [
    0,
    0,
    "trainer",
    null,
    null,
    null,
  ]);

  expect(recordingV2EntryLimit(advances)).toBeNull();
  expect(recordingV2EntryLimit(inputs)).toBeNull();
  expect(recordingV2EntryLimit([...advances, ...inputs])).toBeNull();
  expect(recordingV2EntryLimit([...advances, [0, 0, "advance", 0]])).toBe("advances");
  expect(recordingV2EntryLimit([...inputs, [0, 0, "status", "trainer", "ready"]])).toBe("inputs");
  expect(
    recordingV2EntryLimit([
      [0, 0, "arm"],
      [1, 0, "boundary", "start"],
    ]),
  ).toBeNull();
});

it("bounds observation counts and rejects short windows and repeated arming", () => {
  const ride = envelope();

  const tooMany = RecordingV2Schema.safeParse({
    ...ride,
    observations: Array.from({ length: 21603 }, () => ride.observations[0]),
  });

  expect(tooMany.success).toBe(false);
  expect(
    RecordingV2Schema.safeParse({
      ...ride,
      entries: [
        [0, 0, "arm"],
        [1, 0, "boundary", "start"],
        [2, 999, "advance", 0.999],
        [3, 999, "boundary", "finish"],
      ],
    }).success,
  ).toBe(false);
  expect(
    RecordingV2Schema.safeParse({
      ...ride,
      entries: [
        [0, 0, "arm"],
        [1, 0, "boundary", "start"],
        [2, 1000, "arm"],
        [3, 1000, "boundary", "finish"],
      ],
    }).success,
  ).toBe(false);
  expect(
    RecordingV2Schema.safeParse({
      ...ride,
      initialization: {
        ...ride.initialization,
        workerTimeOriginMs: Number.POSITIVE_INFINITY,
      },
    }).success,
  ).toBe(false);
});

it("applies the canonical envelope byte cap even below each individual array cap", () => {
  const ride = envelope();

  const events = Array.from({ length: 25_000 }, () => ({
    type: "segment.entered",
    segmentId: "界".repeat(100),
    tS: 0,
  }));

  const oversized = {
    ...ride,
    observations: [{ ...ride.observations[0], events }, ride.observations[1]],
  };

  expect(JSON.stringify(oversized).length).toBeLessThan(MAX_RECORDING_V2_BYTES);
  expect(() => RecordingV2Schema.parse(oversized)).toThrow("UTF-8 byte limit");
});
