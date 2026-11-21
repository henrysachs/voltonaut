import { expect, it } from "vitest";
import { TEST_LOOP } from "@voltonaut/engine";
import type { RecordingEntryV2, RecordingV2, ReplayObservationV2 } from "@voltonaut/shared";

import {
  normalReplay,
  recordReplay,
  replayed,
  replayEngine,
  windowFailures,
} from "../testing/replay.spec.js";
import { assessRecordingV2 } from "./replay.js";

it("keeps the first wake as arming only even when capture starts before it", () => {
  const ride = recordReplay([
    [0, 0, "boundary", "start"],
    [1, 50, "arm"],
    [2, 50, "trainer", 250, 90, null],
    [3, 1050, "advance", 1],
    [4, 1050, "boundary", "finish"],
  ]);

  expect(replayed(ride).summary.tS).toBeCloseTo(1, 12);
  expect(replayed(ride).summary.elapsedRealS).toBe(1.05);
});

it("holds absent partial fields, preserves true zero and consumes freshness once", () => {
  const live = replayEngine();
  live.ingest({ type: "trainer.data", tS: 9999, powerW: 250, cadenceRpm: 90 });
  live.ingest({ type: "trainer.data", tS: -9999, cadenceRpm: 80 });
  live.advance(1);
  expect(live.snapshot().energyKj).toBeCloseTo(0.25, 12);
  expect(live.snapshot().dataAgeS).toBeCloseTo(0.95, 12);
  live.ingest({ type: "trainer.data", tS: 0, powerW: 0 });
  live.advance(1);
  expect(live.snapshot().energyKj).toBeCloseTo(0.25, 12);
  expect(live.snapshot().cadenceRpm).toBeGreaterThan(60);
  live.ingest({ type: "trainer.data", tS: 0 });
  live.advance(0.05);
  expect(live.snapshot().dataAgeS).toBe(0);
});

it("distinguishes per-channel 2.5s export freshness from engine's >3s hold", () => {
  for (const durationMs of [2500, 2501]) {
    const ride = recordReplay([
      [0, 0, "arm"],
      [1, 0, "status", "trainer", "ready"],
      [2, 0, "trainer", 250, 90, null],
      [3, 0, "boundary", "start"],
      [4, durationMs, "advance", durationMs / 1000],
      [5, durationMs, "boundary", "finish"],
    ]);

    const result = replayed(ride);
    expect(result.summary.energyKj).toBeCloseTo(0.625, 12);
    expect(windowFailures(ride).includes("stale_trainer")).toBe(durationMs > 2500);
  }
});

it("zeros stale raw power only after three engine seconds", () => {
  const live = replayEngine();
  live.ingest({ type: "trainer.data", tS: 0, powerW: 250, cadenceRpm: 90 });

  for (let tick = 0; tick < 61; tick += 1) live.advance(0.05);
  const before = live.snapshot();
  expect(before.dataAgeS).toBeCloseTo(3, 12);
  expect(before.energyKj).toBeCloseTo(0.7625, 12);
  live.advance(0.05);
  expect(live.snapshot().dataAgeS).toBeGreaterThan(3);
  expect(live.snapshot().energyKj).toBe(before.energyKj);
});

it("ages paused ticks without advancing ride time, then resumes from fresh input", () => {
  const ride = recordReplay([
    [0, 0, "arm"],
    [1, 0, "boundary", "start"],
    [2, 5000, "advance", 5],
    [3, 5000, "boundary", "sample"],
    [4, 5050, "advance", 0.05],
    [5, 5050, "boundary", "sample"],
    [6, 6050, "advance", 1],
    [7, 6050, "boundary", "sample"],
    [8, 6050, "trainer", 250, 90, null],
    [9, 7050, "advance", 1],
    [10, 7050, "boundary", "finish"],
  ]);

  const paused = ride.observations[2]?.snapshot;
  const later = ride.observations[3]?.snapshot;
  expect(paused?.paused).toBe(true);
  expect(later?.tS).toBe(paused?.tS);
  expect(Number(later?.dataAgeS)).toBeGreaterThan(Number(paused?.dataAgeS));
  expect(ride.observations.at(-1)?.snapshot.paused).toBe(false);
  expect(windowFailures(ride)).toContain("stale_trainer");
});

it("detects reordered shifts across a tick even with contiguous replacement sequences", () => {
  const ride = recordReplay([
    [0, 0, "arm"],
    [1, 0, "boundary", "start"],
    [2, 0, "trainer", 250, 90, null],
    [3, 0, "shift", "shiftUp"],
    [4, 50, "advance", 0.05],
    [5, 50, "shift", "shiftDown"],
    [6, 1000, "advance", 0.95],
    [7, 1000, "boundary", "finish"],
  ]);

  const entries: readonly RecordingEntryV2[] = [
    [0, 0, "arm"],
    [1, 0, "boundary", "start"],
    [2, 0, "trainer", 250, 90, null],
    [3, 0, "shift", "shiftDown"],
    [4, 50, "advance", 0.05],
    [5, 50, "shift", "shiftUp"],
    [6, 1000, "advance", 0.95],
    [7, 1000, "boundary", "finish"],
  ];

  expect(replayed(ride).summary.eventCount).toBeGreaterThan(20);
  expect(assessRecordingV2({ ...ride, entries }).status).toBe("rejected");
});

it("replays allowlisted route segments and lap crossing from zero initialization", () => {
  const durationS = 480;

  const entries: RecordingEntryV2[] = [
    [0, 0, "arm"],
    [1, 0, "boundary", "start"],
  ];

  for (let second = 0; second < durationS; second += 1) {
    entries.push(
      [entries.length, second * 1000, "trainer", 2000, 90, null],
      [entries.length + 1, (second + 1) * 1000, "advance", 1],
    );
  }

  entries.push([entries.length, durationS * 1000, "boundary", "finish"]);
  const ride = recordReplay(entries);
  const result = replayed(ride);
  expect(result.summary.distanceM).toBeGreaterThan(TEST_LOOP.lengthM);
  expect(result.summary.laps).toBeGreaterThanOrEqual(1);
  expect(result.summary.laps).toBe(1);
  expect(ride.observations.at(-1)?.events.some((event) => event.type === "lap.completed")).toBe(
    true,
  );
  expect(ride.observations.at(-1)?.events.some((event) => event.type === "segment.exited")).toBe(
    true,
  );
});

function replaceFinish(ride: RecordingV2, patch: Partial<ReplayObservationV2>): RecordingV2 {
  return {
    ...ride,
    observations: ride.observations.map((observation, index) => {
      if (index !== ride.observations.length - 1) return observation;

      return { ...observation, ...patch };
    }),
  };
}

function finishObservation(ride: RecordingV2): ReplayObservationV2 {
  const finish = ride.observations.at(-1);

  if (finish === undefined) throw new Error("Missing test observation");

  return finish;
}

it("checks every output including missing, extra, reordered and changed commands", () => {
  const ride = normalReplay();
  const finish = finishObservation(ride);
  expect(assessRecordingV2(replaceFinish(ride, { events: [] })).status).toBe("rejected");
  expect(
    assessRecordingV2(replaceFinish(ride, { events: [{ type: "ride.started" }] })).status,
  ).toBe("rejected");
  expect(
    assessRecordingV2(replaceFinish(ride, { events: finish.events.toReversed() })).status,
  ).toBe("rejected");
  expect(assessRecordingV2(replaceFinish(ride, { commands: [] })).status).toBe("rejected");
  expect(
    assessRecordingV2(replaceFinish(ride, { commands: [{ type: "resistance", level: 1 }] })).status,
  ).toBe("rejected");
  expect(
    assessRecordingV2(
      replaceFinish(ride, {
        commands: [{ type: "simulation", gradePct: 20, windMps: 0, crr: 0.004, cwKgPerM: 0.2 }],
      }),
    ).status,
  ).toBe("rejected");
  expect(assessRecordingV2(replaceFinish(ride, { gap: true })).status).toBe("replayed");
  expect(replayed(replaceFinish(ride, { gap: true })).source.window).toEqual({
    kind: "blocked",
    reasons: ["gap"],
  });
});

it("keeps ordinary BLE consistency explicitly client declared, not hardware attested", () => {
  expect(replayed(normalReplay()).source).toEqual({
    assurance: "client_declared",
    declaredSource: "ble",
    window: { kind: "continuous" },
  });
});
