import { expect, it } from "vitest";

import { RecordingV2Schema } from "./recordingV2.js";
import { projectRecordingTrack } from "./recordingTrack.js";
import { recordedRide, recordingObservation } from "./testdata/recording.js";

it("exports only the selected real-time window with raw rather than smoothed readings", () => {
  const recording = recordedRide();
  const before = JSON.stringify(recording);
  const track = projectRecordingTrack(recording);

  expect(track.startedAt).toBe("2026-11-20T12:00:01.000Z");
  expect(track.rideId).toBe(recording.rideId);
  expect(track.metadata).toEqual({
    source: "ble",
    routeId: "test-loop",
    routeRevision: "1",
    physicsClockScale: 1,
    profile: recording.initialization.profile,
  });
  expect(track.samples).toEqual([
    { elapsedMs: 0, distanceM: 0, powerW: 200, cadenceRpm: 90, hrBpm: 130, gap: false },
    { elapsedMs: 1000, distanceM: 3, powerW: 200, cadenceRpm: 92, hrBpm: 130, gap: false },
    { elapsedMs: 2000, distanceM: 6, powerW: 0, cadenceRpm: 92, hrBpm: 130, gap: false },
  ]);
  expect(JSON.stringify(recording)).toBe(before);
});

it("expires raw fields independently without inventing zero or interpolated readings", () => {
  const recording = recordedRide();

  const delayed = RecordingV2Schema.parse({
    ...recording,
    entries: [
      ...recording.entries.slice(0, 7),
      [7, 4101, "advance", (4101 - 2000) / 1000],
      [8, 4101, "boundary", "sample"],
      [9, 4500, "trainer", 0, null, null],
      [10, 5000, "advance", (5000 - 4101) / 1000],
      [11, 5000, "boundary", "finish"],
    ],
  });

  const track = projectRecordingTrack(delayed);

  expect(track.samples[1]).toEqual({
    elapsedMs: 2101,
    distanceM: 3,
    cadenceRpm: 92,
    gap: true,
  });
  expect(track.samples[2]).toEqual({ elapsedMs: 3000, distanceM: 6, powerW: 0, gap: true });
});

it("retains a recovered trainer interruption between samples while omitting lost heart rate", () => {
  const recording = recordedRide();

  const interrupted = RecordingV2Schema.parse({
    ...recording,
    entries: [
      ...recording.entries.slice(0, 7),
      [7, 2400, "status", "trainer", "disconnected"],
      [8, 2450, "status", "heartRate", "error"],
      [9, 2500, "status", "trainer", "ready"],
      [10, 2600, "trainer", 210, 93, null],
      [11, 3000, "advance", 1],
      [12, 3000, "boundary", "sample"],
      [13, 4000, "advance", 1],
      [14, 4000, "boundary", "finish"],
    ],
    window: { startSeq: 5, finishSeq: 14 },
    observations: [
      recordingObservation(5, 100, 1),
      recordingObservation(12, 103, 2),
      recordingObservation(14, 106, 3),
    ],
  });

  expect(projectRecordingTrack(interrupted).samples).toEqual([
    { elapsedMs: 0, distanceM: 0, powerW: 200, cadenceRpm: 90, hrBpm: 130, gap: false },
    { elapsedMs: 1000, distanceM: 3, powerW: 210, cadenceRpm: 93, gap: true },
    { elapsedMs: 2000, distanceM: 6, powerW: 210, cadenceRpm: 93, gap: false },
  ]);
});

it("keeps the finish values when two committed boundaries share one exported millisecond", () => {
  const recording = recordedRide();

  const coincident = RecordingV2Schema.parse({
    ...recording,
    entries: [
      ...recording.entries.slice(0, 9),
      [9, 3000, "trainer", 0, 95, null],
      [10, 3000, "boundary", "finish"],
    ],
    window: { startSeq: 5, finishSeq: 10 },
    observations: [
      recordingObservation(5, 100, 1),
      recordingObservation(8, 103, 2),
      recordingObservation(10, 103, 2),
    ],
  });

  expect(projectRecordingTrack(coincident).samples).toEqual([
    { elapsedMs: 0, distanceM: 0, powerW: 200, cadenceRpm: 90, hrBpm: 130, gap: false },
    { elapsedMs: 1000, distanceM: 3, powerW: 0, cadenceRpm: 95, hrBpm: 130, gap: false },
  ]);
});

it("keeps the zero-distance origin when a later boundary rounds to elapsed zero", () => {
  const recording = recordedRide();
  const startMs = 1999.8;
  const sampleMs = 2000.2;
  const finishMs = 3000.8;

  const fractional = RecordingV2Schema.parse({
    ...recording,
    entries: [
      ...recording.entries.slice(0, 4),
      [4, startMs, "advance", (startMs - 1000) / 1000],
      [5, startMs, "boundary", "start"],
      [6, 2000.1, "trainer", 210, 93, null],
      [7, sampleMs, "advance", (sampleMs - startMs) / 1000],
      [8, sampleMs, "boundary", "sample"],
      [9, finishMs, "advance", (finishMs - sampleMs) / 1000],
      [10, finishMs, "boundary", "finish"],
    ],
    window: { startSeq: 5, finishSeq: 10 },
    observations: [
      recordingObservation(5, 100, 0.95),
      recordingObservation(8, 100.15, 1),
      recordingObservation(10, 103, 2),
    ],
  });

  expect(projectRecordingTrack(fractional).samples).toEqual([
    { elapsedMs: 0, distanceM: 0, powerW: 210, cadenceRpm: 93, hrBpm: 130, gap: false },
    { elapsedMs: 1001, distanceM: 3, powerW: 210, cadenceRpm: 93, hrBpm: 130, gap: false },
  ]);
});

it("does not turn a fast physics clock into a fast TCX timeline", () => {
  const recording = recordedRide();

  const accelerated = RecordingV2Schema.parse({
    ...recording,
    initialization: { ...recording.initialization, source: "sim", clockScale: 20 },
    observations: recording.observations.map((observation) =>
      Object.assign({}, observation, {
        snapshot: Object.assign({}, observation.snapshot, { tS: observation.snapshot.tS * 20 }),
      }),
    ),
  });

  const track = projectRecordingTrack(accelerated);

  expect(track.metadata.physicsClockScale).toBe(20);
  expect(track.metadata.source).toBe("sim");
  expect(track.samples.map((point) => point.elapsedMs)).toEqual([0, 1000, 2000]);
});
