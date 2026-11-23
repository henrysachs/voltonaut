import { createEngine, createRoute, FLAT_LOOP, type RideSnapshot } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE, type RideEvent } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createSegmentProjector } from "./segments.js";

const route = {
  lengthM: 100,
  loop: true,
  segments: [
    { id: "sprint", name: "Sprint", kind: "sprint", startM: 10, endM: 30 },
    { id: "kom", name: "KOM", kind: "kom", startM: 20, endM: 50 },
    { id: "lap", name: "Lap", kind: "lap", startM: 0, endM: 100 },
  ],
} satisfies Parameters<typeof createSegmentProjector>[0];

const initial = createEngine({
  route: createRoute(FLAT_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

function snapshot(tS: number, routePosM: number, lap = 0): RideSnapshot {
  return { ...initial, tS, routePosM, lap, distanceM: lap * 100 + routePosM };
}

function entered(segmentId: string, tS: number): RideEvent {
  return { type: "segment.entered", segmentId, tS };
}

function exited(segmentId: string, tS: number): RideEvent {
  return { type: "segment.exited", segmentId, tS };
}

function progress(projector: ReturnType<typeof createSegmentProjector>, id = "sprint") {
  return projector.view().rows.find((row) => row.segment.id === id)?.progress;
}

it("starts idle, excludes lap markers and declares tick timing", () => {
  const projector = createSegmentProjector(route);
  expect(projector.view()).toMatchObject({ scope: "session_preview", timing: "tick" });
  expect(projector.view().rows).toHaveLength(2);
  expect(progress(projector)).toEqual({ kind: "idle" });
});

it("uses event times, not the last batch snapshot, and does not reset a duplicate entry", () => {
  const projector = createSegmentProjector(route);
  projector.consume({ events: [entered("sprint", 2)], snapshot: snapshot(4, 20) });
  expect(progress(projector)).toEqual({ kind: "active", lap: 0, elapsedS: 2, remainingM: 10 });
  projector.consume({ events: [entered("sprint", 4.5)], snapshot: snapshot(5, 25) });
  expect(progress(projector)).toMatchObject({ elapsedS: 3 });
  projector.consume({ events: [exited("sprint", 6)], snapshot: snapshot(9, 40) });
  expect(progress(projector)).toEqual({ kind: "finished", lap: 0, timeS: 4 });
  projector.consume({ events: [exited("sprint", 6)], snapshot: snapshot(10, 45) });
  expect(progress(projector)).toEqual({ kind: "finished", lap: 0, timeS: 4 });
});

it("assigns each attempt its event-order lap across several laps in one batch", () => {
  const projector = createSegmentProjector(route);
  projector.consume({
    events: [
      entered("sprint", 1),
      exited("sprint", 3),
      { type: "lap.completed", lap: 1, tS: 10 },
      entered("sprint", 11),
      exited("sprint", 14),
      { type: "lap.completed", lap: 2, tS: 20 },
      entered("kom", 21),
      exited("kom", 25),
    ],
    snapshot: snapshot(28, 60, 2),
  });
  expect(progress(projector)).toEqual({ kind: "finished", lap: 1, timeS: 3 });
  expect(progress(projector, "kom")).toEqual({ kind: "finished", lap: 2, timeS: 4 });
});

it("keeps overlapping sprint and KOM attempts independent and ignores unknown IDs", () => {
  const projector = createSegmentProjector(route);
  projector.consume({
    events: [entered("sprint", 1), entered("kom", 2), exited("unknown", 3)],
    snapshot: snapshot(3, 25),
  });
  expect(progress(projector)).toMatchObject({ kind: "active", elapsedS: 2, remainingM: 5 });
  expect(progress(projector, "kom")).toMatchObject({
    kind: "active",
    elapsedS: 1,
    remainingM: 25,
  });
  projector.consume({ events: [exited("sprint", 4)], snapshot: snapshot(5, 40) });
  expect(progress(projector)).toMatchObject({ kind: "finished", timeS: 3 });
  expect(progress(projector, "kom")).toMatchObject({ kind: "active", elapsedS: 3 });
});

it("reports an unmatched exit without disturbing another active segment", () => {
  const projector = createSegmentProjector(route);
  projector.consume({
    events: [entered("kom", 1), exited("sprint", 2)],
    snapshot: snapshot(3, 25),
  });
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "missing_entry" });
  expect(progress(projector, "kom")).toMatchObject({ kind: "active" });
});

it.each([0, -1])("rejects nonpositive duration %s", (duration) => {
  const projector = createSegmentProjector(route);
  projector.consume({
    events: [entered("sprint", 2), exited("sprint", 2 + duration)],
    snapshot: snapshot(4, 40),
  });
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "invalid_timing" });
});

it("freezes elapsed time during auto-pause and rejects backward snapshots", () => {
  const projector = createSegmentProjector(route);
  projector.consume({ events: [entered("sprint", 1)], snapshot: snapshot(3, 20) });
  projector.consume({ events: [], snapshot: { ...snapshot(3, 20), paused: true } });
  expect(progress(projector)).toMatchObject({ kind: "active", elapsedS: 2, remainingM: 10 });
  projector.consume({ events: [], snapshot: snapshot(2, 20) });
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "invalid_timing" });
});

it.each([snapshot(5, 40), snapshot(5, 5, 1), snapshot(5, 15)])(
  "invalidates a missing exit or backward position",
  (next) => {
    const projector = createSegmentProjector(route);
    projector.consume({ events: [entered("sprint", 1)], snapshot: snapshot(3, 20) });
    projector.consume({ events: [], snapshot: next });
    expect(progress(projector)).toEqual({ kind: "invalid", reason: "invalid_timing" });
  },
);

it("invalidates active and batch-touched attempts on clock skip, then recovers only on fresh entry", () => {
  const projector = createSegmentProjector(route);
  projector.consume({ events: [entered("kom", 1)], snapshot: snapshot(2, 25) });
  projector.consume({
    events: [
      entered("sprint", 3),
      exited("sprint", 4),
      { type: "ride.clockSkipped", skippedS: 20 },
    ],
    snapshot: snapshot(5, 40),
  });
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "clock_skipped" });
  expect(progress(projector, "kom")).toEqual({ kind: "invalid", reason: "clock_skipped" });
  projector.consume({ events: [exited("kom", 6)], snapshot: snapshot(7, 60) });
  expect(progress(projector, "kom")).toEqual({ kind: "invalid", reason: "clock_skipped" });
  projector.consume({
    events: [{ type: "lap.completed", lap: 1, tS: 9 }, entered("sprint", 10), exited("sprint", 13)],
    snapshot: snapshot(14, 40, 1),
  });
  expect(progress(projector)).toEqual({ kind: "finished", lap: 1, timeS: 3 });
});

it("invalidates active attempts on failure/stop and a new session starts fresh", () => {
  const projector = createSegmentProjector(route);
  projector.consume({ events: [entered("sprint", 1)], snapshot: snapshot(2, 20) });
  projector.unavailable();
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "engine_unavailable" });
  projector.consume({ events: [exited("sprint", 3)], snapshot: snapshot(4, 40) });
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "engine_unavailable" });
  expect(progress(createSegmentProjector(route))).toEqual({ kind: "idle" });
});

it("does not turn a missing exit into a duration spanning laps", () => {
  const projector = createSegmentProjector(route);
  projector.consume({ events: [entered("sprint", 1)], snapshot: snapshot(2, 20) });
  projector.consume({
    events: [{ type: "lap.completed", lap: 1, tS: 10 }, exited("sprint", 13)],
    snapshot: snapshot(14, 40, 1),
  });
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "invalid_timing" });
});

it("distinguishes an identical repeated exit from an unmatched later exit", () => {
  const projector = createSegmentProjector(route);
  projector.consume({
    events: [entered("sprint", 1), exited("sprint", 2)],
    snapshot: snapshot(3, 40),
  });
  projector.consume({ events: [exited("sprint", 4)], snapshot: snapshot(5, 50) });
  expect(progress(projector)).toEqual({ kind: "invalid", reason: "missing_entry" });
});
