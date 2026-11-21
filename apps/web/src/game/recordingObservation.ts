import type { RideSnapshot } from "@voltonaut/engine";
import type { ReplayObservationV2 } from "@voltonaut/shared";

export function replaySnapshot(snapshot: RideSnapshot): ReplayObservationV2["snapshot"] {
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
