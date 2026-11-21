import { expect, it } from "vitest";

import { createRecordingTrackProjection, projectRecordingTrack } from "./index.js";
import type { LocalRidePoint } from "./localRide.js";
import { RecordingV2Schema, type RecordingV2 } from "./recordingV2.js";
import { recordedRide, recordingObservation } from "./testdata/recording.js";

function incrementalTrack(recording: RecordingV2) {
  const projection = createRecordingTrackProjection(recording);
  const observations = recording.observations.values();
  projection.start(recording.rideId);

  for (const entry of recording.entries) {
    projection.ingest(entry);

    if (entry[2] === "boundary") {
      const observation = observations.next();

      if (observation.done === true) throw new Error("Missing test observation");
      projection.boundary(entry, observation.value);
    }
  }

  return projection.finish();
}

it("projects the valid fixture identically through the public incremental contract", () => {
  const recording = recordedRide();
  expect(incrementalTrack(recording)).toEqual(projectRecordingTrack(recording));
});

it("keeps batch equality and the origin when fractional boundaries round to zero", () => {
  const recording = recordedRide();

  const fractional = RecordingV2Schema.parse({
    ...recording,
    entries: [
      ...recording.entries.slice(0, 4),
      [4, 1999.8, "advance", (1999.8 - 1000) / 1000],
      [5, 1999.8, "boundary", "start"],
      [6, 2000.1, "trainer", 0, 95, null],
      [7, 2000.2, "advance", (2000.2 - 1999.8) / 1000],
      [8, 2000.2, "boundary", "sample"],
      [9, 3000.8, "advance", (3000.8 - 2000.2) / 1000],
      [10, 3000.8, "boundary", "finish"],
    ],
    window: { startSeq: 5, finishSeq: 10 },
    observations: [
      recordingObservation(5, 100, 0.95),
      { ...recordingObservation(8, 100.15, 1), gap: true },
      recordingObservation(10, 103, 2),
    ],
  });

  const track = incrementalTrack(fractional);

  expect(track).toEqual(projectRecordingTrack(fractional));
  expect(track.samples).toEqual([
    { elapsedMs: 0, distanceM: 0, powerW: 0, cadenceRpm: 95, hrBpm: 130, gap: true },
    { elapsedMs: 1001, distanceM: 3, powerW: 0, cadenceRpm: 95, hrBpm: 130, gap: false },
  ]);
});

it("retains warm raw readings across windows but replaces identity, UTC and distance origin", () => {
  const recording = recordedRide();
  const projection = createRecordingTrackProjection(recording);
  projection.ingest([0, 1000, "status", "trainer", "ready"]);
  projection.ingest([1, 1500, "trainer", 0, 90, null]);
  projection.ingest([2, 1500, "hr", 130]);
  projection.start(recording.rideId);
  projection.boundary([3, 2000, "boundary", "start"], recordingObservation(3, 100, 1));
  projection.boundary([4, 3000, "boundary", "finish"], recordingObservation(4, 103, 2));
  const first = projection.finish();
  const before = JSON.stringify(first);
  projection.invalidate("cadenceRpm");
  projection.ingest([5, 3100, "trainer", null, 95, null]);
  const rideId = "22345678-1234-4234-8234-123456789abc";
  projection.start(rideId);
  projection.boundary([6, 3200, "boundary", "start"], recordingObservation(6, 104, 3));
  projection.ingest([7, 4000, "trainer", 210, null, null]);
  projection.boundary([8, 4200, "boundary", "finish"], recordingObservation(8, 108, 4));
  const second = projection.finish();

  expect(first.samples[0]).toEqual({
    elapsedMs: 0,
    distanceM: 0,
    powerW: 0,
    cadenceRpm: 90,
    hrBpm: 130,
    gap: false,
  });
  expect(second.rideId).toBe(rideId);
  expect(second.startedAt).toBe("2026-11-20T12:00:02.200Z");
  expect(second.metadata).toEqual(first.metadata);
  expect(second.samples).toEqual([
    { elapsedMs: 0, distanceM: 0, powerW: 0, cadenceRpm: 95, hrBpm: 130, gap: false },
    { elapsedMs: 1000, distanceM: 4, powerW: 210, cadenceRpm: 95, gap: false },
  ]);
  expect(JSON.stringify(first)).toBe(before);
});

interface InvalidationCase {
  readonly channel: "powerW" | "cadenceRpm" | "hrBpm";
  readonly readings: Pick<LocalRidePoint, "powerW" | "cadenceRpm" | "hrBpm">;
  readonly gap: boolean;
}

it.each<InvalidationCase>([
  { channel: "powerW", readings: { cadenceRpm: 90, hrBpm: 130 }, gap: true },
  { channel: "cadenceRpm", readings: { powerW: 200, hrBpm: 130 }, gap: true },
  { channel: "hrBpm", readings: { powerW: 200, cadenceRpm: 90 }, gap: false },
])(
  "invalidates only $channel without inventing a device disconnect",
  ({ channel, readings, gap }) => {
    const recording = recordedRide();
    const projection = createRecordingTrackProjection(recording);
    projection.ingest([0, 1000, "status", "trainer", "ready"]);
    projection.ingest([1, 1500, "trainer", 200, 90, null]);
    projection.ingest([2, 1500, "hr", 130]);
    projection.start(recording.rideId);
    projection.boundary([3, 2000, "boundary", "start"], recordingObservation(3, 100, 1));
    projection.invalidate(channel);
    projection.boundary([4, 2500, "boundary", "sample"], recordingObservation(4, 102, 1.5));
    projection.ingest([5, 2600, "trainer", 210, 95, null]);
    projection.ingest([6, 2600, "hr", 135]);
    projection.boundary([7, 3000, "boundary", "finish"], recordingObservation(7, 103, 2));
    const track = projection.finish();

    expect(track.samples[1]).toEqual({
      elapsedMs: 500,
      distanceM: 2,
      ...readings,
      gap,
    });
    expect(track.samples[2]).toEqual({
      elapsedMs: 1000,
      distanceM: 3,
      powerW: 210,
      cadenceRpm: 95,
      hrBpm: 135,
      gap,
    });
  },
);

it.each(["powerW", "cadenceRpm"] satisfies readonly ("powerW" | "cadenceRpm")[])(
  "does not heal an invalidated %s interval before the next boundary",
  (channel) => {
    const recording = recordedRide();
    const projection = createRecordingTrackProjection(recording);
    projection.ingest([0, 1000, "status", "trainer", "ready"]);
    projection.ingest([1, 1500, "trainer", 200, 90, null]);
    projection.start(recording.rideId);
    projection.boundary([2, 2000, "boundary", "start"], recordingObservation(2, 100, 1));
    projection.invalidate(channel);
    projection.ingest([3, 2100, "trainer", 210, 95, null]);
    projection.boundary([4, 2500, "boundary", "sample"], recordingObservation(4, 102, 1.5));
    projection.boundary([5, 3000, "boundary", "finish"], recordingObservation(5, 103, 2));

    expect(projection.finish().samples.map((sample) => sample.gap)).toEqual([false, true, false]);
  },
);

it("requires an armed window and an actual start boundary", () => {
  const recording = recordedRide();
  const projection = createRecordingTrackProjection(recording);
  projection.boundary([0, 2000, "boundary", "start"], recordingObservation(0, 100, 1));
  expect(() => projection.finish()).toThrow("Aufnahmefenster fehlt.");
  projection.start(recording.rideId);
  projection.boundary([1, 2500, "boundary", "sample"], recordingObservation(1, 102, 1.5));
  expect(() => projection.finish()).toThrow("Aufnahmefenster fehlt.");
});
