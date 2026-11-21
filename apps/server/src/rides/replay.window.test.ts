import { expect, it } from "vitest";
import type { RecordingEntryV2 } from "@voltonaut/shared";

import { recordReplay, replayed, windowFailures } from "../testing/replay.spec.js";
import { assessRecordingV2 } from "./replay.js";

function windowRide(prefix: readonly RecordingEntryV2[] = []) {
  const entries: RecordingEntryV2[] = [...prefix];
  const atMs = prefix.at(-1)?.[1] ?? 0;
  entries.push(
    [entries.length, atMs, "status", "trainer", "ready"],
    [entries.length + 1, atMs, "trainer", 300, 90, null],
    [entries.length + 2, atMs, "boundary", "start"],
    [entries.length + 3, atMs + 1000, "advance", 1],
    [entries.length + 4, atMs + 1000, "boundary", "finish"],
  );

  return recordReplay(entries);
}

it("keeps healthy delayed capture continuous after discarded warmup failures", () => {
  const ride = windowRide([
    [0, 0, "arm"],
    [1, 0, "status", "trainer", "disconnected"],
    [2, 12000, "advance", 12],
  ]);

  expect(replayed(ride).source).toEqual({
    assurance: "client_declared",
    declaredSource: "ble",
    window: { kind: "continuous" },
  });
  expect(replayed(ride).summary.elapsedRealS).toBe(1);
});

it("does not mistake a fresh pending raw reading for an old snapshot", () => {
  expect(replayed(windowRide([[0, 0, "arm"]])).source.window).toEqual({ kind: "continuous" });
});

function maliciousPrefix(entries: readonly RecordingEntryV2[]): readonly RecordingEntryV2[] {
  return entries.map((entry): RecordingEntryV2 => {
    if (entry[0] !== 1) return entry;

    return [1, 0, "trainer", 500, 90, null];
  });
}

it("still replays every warmup operation rather than skipping a malicious prefix", () => {
  const ride = windowRide([
    [0, 0, "arm"],
    [1, 0, "trainer", 250, 90, null],
    [2, 1000, "advance", 1],
  ]);

  expect(assessRecordingV2({ ...ride, entries: maliciousPrefix(ride.entries) })).toEqual({
    status: "rejected",
    reason: "observation_mismatch",
  });
});

it.each([
  ["empty", null, null],
  ["power", 250, null],
  ["cadence", null, 90],
  ["both", 250, 90],
] satisfies readonly (readonly [string, number | null, number | null])[])(
  "does not heal stale intervals with %s updates",
  (_field, powerW, cadenceRpm) => {
    const ride = recordReplay([
      [0, 0, "arm"],
      [1, 0, "status", "trainer", "ready"],
      [2, 0, "trainer", 250, 90, null],
      [3, 0, "boundary", "start"],
      [4, 3000, "trainer", powerW, cadenceRpm, null],
      [5, 3000, "advance", 3],
      [6, 3000, "boundary", "finish"],
    ]);

    expect(windowFailures(ride)).toContain("stale_trainer");
  },
);

it("requires both fresh channels after disconnect, not a ready marker alone", () => {
  const ride = recordReplay([
    [0, 0, "arm"],
    [1, 0, "status", "trainer", "ready"],
    [2, 0, "trainer", 250, 90, null],
    [3, 500, "status", "trainer", "disconnected"],
    [4, 500, "status", "trainer", "ready"],
    [5, 500, "trainer", 250, null, null],
    [6, 500, "boundary", "start"],
    [7, 1500, "advance", 1.5],
    [8, 1500, "boundary", "finish"],
  ]);

  expect(windowFailures(ride)).toContain("stale_trainer");
});

it("checks a real long advance crossing the start despite a recent boundary", () => {
  const ride = recordReplay([
    [0, 0, "arm"],
    [1, 11900, "status", "trainer", "ready"],
    [2, 11900, "trainer", 250, 90, null],
    [3, 11900, "boundary", "start"],
    [4, 12000, "advance", 12],
    [5, 12000, "boundary", "sample"],
    [6, 13000, "trainer", 250, 90, null],
    [7, 13000, "advance", 1],
    [8, 13000, "boundary", "finish"],
  ]);

  expect(windowFailures(ride)).toEqual(expect.arrayContaining(["gap", "clock_skipped"]));
});
