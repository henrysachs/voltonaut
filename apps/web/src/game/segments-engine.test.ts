import { createEngine, createRoute, type RouteData } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE, type RideEvent } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createSegmentProjector, type SegmentHudView, type SegmentProgress } from "./segments.js";

const data: RouteData = {
  id: "segment-unit-loop",
  name: "Segment unit loop",
  lengthM: 100,
  loop: true,
  centerline: [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 0, z: 0 },
  ],
  profileSamples: [
    { distanceM: 0, elevationM: 0 },
    { distanceM: 100, elevationM: 0 },
  ],
  segments: [
    { id: "sprint", name: "Sprint", kind: "sprint", startM: 10, endM: 30 },
    { id: "kom", name: "KOM", kind: "kom", startM: 20, endM: 50 },
  ],
  scenery: "test",
};

function collectFinishes(
  view: SegmentHudView,
  expected: Readonly<
    Pick<ReadonlyMap<string, { readonly lap: number; readonly timeS: number }>, "get">
  >,
) {
  const actual: SegmentProgress[] = [];
  const expectedFinishes: SegmentProgress[] = [];
  const invalid: SegmentProgress[] = [];

  for (const row of view.rows) {
    if (row.progress.kind === "finished") {
      const result = expected.get(row.segment.id);

      if (result === undefined) throw new Error("Projection finished without Engine exit");
      actual.push(row.progress);
      expectedFinishes.push({ kind: "finished", ...result });
    }

    if (row.progress.kind === "invalid") invalid.push(row.progress);
  }

  return { actual, expectedFinishes, invalid };
}

function runEngine() {
  const route = createRoute(data);
  const engine = createEngine({ route, profile: DEFAULT_RIDER_PROFILE });
  const projector = createSegmentProjector(route);
  const entries = new Map<string, number>();
  const expected = new Map<string, { readonly lap: number; readonly timeS: number }>();
  let lap = 0;
  let finishes = 0;
  let earlierThanSnapshot = false;
  const actual: SegmentProgress[] = [];
  const expectedFinishes: SegmentProgress[] = [];
  const invalid: SegmentProgress[] = [];

  function observe(event: RideEvent, snapshotTS: number): void {
    if (event.type === "lap.completed") lap = event.lap;

    if (event.type === "segment.entered") entries.set(event.segmentId, event.tS);

    if (event.type !== "segment.exited") return;

    const start = entries.get(event.segmentId);

    if (start === undefined) throw new Error("Engine exit without entry");

    expected.set(event.segmentId, { lap, timeS: event.tS - start });
    earlierThanSnapshot ||= event.tS < snapshotTS;
    finishes += 1;
  }

  for (let second = 0; second < 50; second += 1) {
    engine.ingest({ type: "trainer.data", tS: second, powerW: 210, cadenceRpm: 90 });
    engine.advance(1);
    const snapshot = engine.snapshot();
    const events = engine.drainEvents();

    for (const event of events) observe(event, snapshot.tS);
    projector.consume({ events, snapshot });

    const observed = collectFinishes(projector.view(), expected);
    actual.push(...observed.actual);
    expectedFinishes.push(...observed.expectedFinishes);
    invalid.push(...observed.invalid);
  }

  return { lap, finishes, earlierThanSnapshot, actual, expectedFinishes, invalid };
}

it("projects exact drained Engine event durations over multiple laps without snapshot timestamps replacing them", () => {
  const result = runEngine();
  expect(result.actual).toEqual(result.expectedFinishes);
  expect(result.actual.length).toBeGreaterThan(0);
  expect(result.invalid).toEqual([]);
  expect(result.lap).toBeGreaterThanOrEqual(2);
  expect(result.finishes).toBeGreaterThanOrEqual(6);
  expect(result.earlierThanSnapshot).toBe(true);
});
