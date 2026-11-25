import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIDER_PROFILE,
  ReplaySnapshotV2Schema,
  type ReplaySnapshotV2,
} from "@voltonaut/shared";

import { TEST_LOOP } from "../elevation/data/test-loop.js";
import { createRoute } from "../elevation/route.js";
import { createEngine, type RideSnapshot } from "../internal/engine.js";
import { projectReplaySnapshot, replayNumberEqual, replaySnapshotEqual } from "./replaySnapshot.js";

function riddenSnapshot(hrBpm?: number): RideSnapshot {
  const engine = createEngine({ route: createRoute(TEST_LOOP), profile: DEFAULT_RIDER_PROFILE });
  engine.ingest({ type: "trainer.data", tS: 0, powerW: 260, cadenceRpm: 88 });

  if (hrBpm !== undefined) engine.ingest({ type: "hr.data", tS: 0, bpm: hrBpm });
  engine.advance(2);

  return engine.snapshot();
}

describe("projectReplaySnapshot", () => {
  it("keeps exactly the journal fields and flattens the gear", () => {
    const snapshot = riddenSnapshot(140);
    const projected = projectReplaySnapshot(snapshot);

    expect(projected).toEqual({
      tS: snapshot.tS,
      distanceM: snapshot.distanceM,
      routePosM: snapshot.routePosM,
      lap: snapshot.lap,
      speedMps: snapshot.speedMps,
      powerW: snapshot.powerW,
      cadenceRpm: snapshot.cadenceRpm,
      hrBpm: snapshot.hrBpm,
      gradePct: snapshot.gradePct,
      gearIndex: snapshot.gear.index,
      gearRatio: snapshot.gear.ratio,
      elevationGainM: snapshot.elevationGainM,
      energyKj: snapshot.energyKj,
      paused: snapshot.paused,
      dataAgeS: snapshot.dataAgeS,
    });
    expect(ReplaySnapshotV2Schema.parse(projected)).toEqual(projected);
    expect(projected.hrBpm).toBeGreaterThan(0);
    expect(replaySnapshotEqual(snapshot, projected)).toBe(true);
  });

  it("writes a missing heart rate as null", () => {
    expect(projectReplaySnapshot(riddenSnapshot()).hrBpm).toBeNull();
  });
});

describe("replayNumberEqual", () => {
  it("allows 1e-6 absolute or 1e-9 relative drift", () => {
    expect(replayNumberEqual(1, 1 + 1e-6)).toBe(true);
    expect(replayNumberEqual(1, 1 + 2e-6)).toBe(false);
    expect(replayNumberEqual(0, 1e-6)).toBe(true);
    expect(replayNumberEqual(1e6, 1e6 + 9e-4)).toBe(true);
    expect(replayNumberEqual(1e6, 1e6 + 2e-3)).toBe(false);
    expect(replayNumberEqual(-1e6, -1e6 - 9e-4)).toBe(true);
    expect(replayNumberEqual(1e6 + 2e-3, 1e6)).toBe(false);
  });

  it("never matches non-finite values", () => {
    expect(replayNumberEqual(Number.NaN, Number.NaN)).toBe(false);
    expect(replayNumberEqual(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(false);
    expect(replayNumberEqual(0, Number.NaN)).toBe(false);
    expect(replayNumberEqual(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(replayNumberEqual(Number.NEGATIVE_INFINITY, 0)).toBe(false);
    expect(replayNumberEqual(Number.NaN, 0)).toBe(false);
  });
});

type NumericField = Exclude<keyof ReplaySnapshotV2, "paused" | "hrBpm">;

const snapshot = riddenSnapshot(140);
const claimed = projectReplaySnapshot(snapshot);

describe("replaySnapshotEqual field coverage", () => {
  it.each<NumericField>([
    "tS",
    "distanceM",
    "routePosM",
    "lap",
    "speedMps",
    "powerW",
    "cadenceRpm",
    "gradePct",
    "gearIndex",
    "gearRatio",
    "elevationGainM",
    "energyKj",
    "dataAgeS",
  ])("rejects a claim whose %s is off by one", (field) => {
    expect(replaySnapshotEqual(snapshot, { ...claimed, [field]: claimed[field] + 1 })).toBe(false);
  });

  it("rejects a flipped pause flag", () => {
    expect(replaySnapshotEqual(snapshot, { ...claimed, paused: !claimed.paused })).toBe(false);
  });
});

describe("replaySnapshotEqual tolerance", () => {
  it("compares tick-counted fields exactly", () => {
    expect(replaySnapshotEqual(snapshot, { ...claimed, tS: claimed.tS + 1e-9 })).toBe(false);
    expect(replaySnapshotEqual(snapshot, { ...claimed, dataAgeS: claimed.dataAgeS + 1e-9 })).toBe(
      false,
    );
    expect(replaySnapshotEqual(snapshot, { ...claimed, energyKj: claimed.energyKj + 1e-9 })).toBe(
      true,
    );
  });

  it("matches heart rate presence and value in both directions", () => {
    const withoutHr = riddenSnapshot();

    expect(replaySnapshotEqual(snapshot, { ...claimed, hrBpm: null })).toBe(false);
    expect(replaySnapshotEqual(snapshot, { ...claimed, hrBpm: 251 })).toBe(false);
    expect(replaySnapshotEqual(withoutHr, projectReplaySnapshot(withoutHr))).toBe(true);
    expect(
      replaySnapshotEqual(withoutHr, { ...projectReplaySnapshot(withoutHr), hrBpm: 140 }),
    ).toBe(false);
  });
});
