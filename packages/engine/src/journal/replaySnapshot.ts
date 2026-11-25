import type { ReplaySnapshotV2 } from "@voltonaut/shared";

import type { RideSnapshot } from "../internal/engine.js";

/** Journal form of a snapshot: replay-relevant fields only, no render pose or mode view. */
export function projectReplaySnapshot(snapshot: RideSnapshot): ReplaySnapshotV2 {
  return {
    tS: snapshot.tS,
    distanceM: snapshot.distanceM,
    routePosM: snapshot.routePosM,
    lap: snapshot.lap,
    speedMps: snapshot.speedMps,
    powerW: snapshot.powerW,
    cadenceRpm: snapshot.cadenceRpm,
    hrBpm: snapshot.hrBpm ?? null,
    gradePct: snapshot.gradePct,
    gearIndex: snapshot.gear.index,
    gearRatio: snapshot.gear.ratio,
    elevationGainM: snapshot.elevationGainM,
    energyKj: snapshot.energyKj,
    paused: snapshot.paused,
    dataAgeS: snapshot.dataAgeS,
  };
}

/** Finite match within 1e-6 absolute or 1e-9 relative, whichever is larger. */
export function replayNumberEqual(actual: number, claimed: number): boolean {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(claimed) &&
    Math.abs(actual - claimed) <=
      Math.max(1e-6, 1e-9 * Math.max(Math.abs(actual), Math.abs(claimed)))
  );
}

/** Tick-counted fields match exactly; continuous quantities within replayNumberEqual. */
export function replaySnapshotEqual(actual: RideSnapshot, claimed: ReplaySnapshotV2): boolean {
  return (
    actual.tS === claimed.tS &&
    actual.dataAgeS === claimed.dataAgeS &&
    actual.lap === claimed.lap &&
    actual.paused === claimed.paused &&
    actual.gear.index === claimed.gearIndex &&
    replayNumberEqual(actual.distanceM, claimed.distanceM) &&
    replayNumberEqual(actual.routePosM, claimed.routePosM) &&
    replayNumberEqual(actual.speedMps, claimed.speedMps) &&
    replayNumberEqual(actual.powerW, claimed.powerW) &&
    replayNumberEqual(actual.cadenceRpm, claimed.cadenceRpm) &&
    (actual.hrBpm === undefined
      ? claimed.hrBpm === null
      : claimed.hrBpm !== null && replayNumberEqual(actual.hrBpm, claimed.hrBpm)) &&
    replayNumberEqual(actual.gradePct, claimed.gradePct) &&
    replayNumberEqual(actual.gear.ratio, claimed.gearRatio) &&
    replayNumberEqual(actual.elevationGainM, claimed.elevationGainM) &&
    replayNumberEqual(actual.energyKj, claimed.energyKj)
  );
}
