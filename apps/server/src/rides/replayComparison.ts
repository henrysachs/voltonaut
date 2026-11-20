import type { RideSnapshot } from "@voltonaut/engine";
import type {
  ReplayObservationV2,
  ReplaySnapshotV2,
  RideEvent,
  TrainerCommand,
} from "@voltonaut/shared";

export function replayNumberEqual(actual: number, claimed: number): boolean {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(claimed) &&
    Math.abs(actual - claimed) <=
      Math.max(1e-6, 1e-9 * Math.max(Math.abs(actual), Math.abs(claimed)))
  );
}

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

export function replayEventEqual(
  actual: RideEvent,
  claimed: ReplayObservationV2["events"][number] | undefined,
): boolean {
  if (claimed === undefined || actual.type !== claimed.type) {
    return false;
  }

  switch (actual.type) {
    case "ride.started":
      return true;
    case "gear.changed":
      return (
        claimed.type === "gear.changed" && actual.from === claimed.from && actual.to === claimed.to
      );
    case "distance.tick":
      return (
        claimed.type === "distance.tick" &&
        replayNumberEqual(actual.deltaM, claimed.deltaM) &&
        replayNumberEqual(actual.deltaElevM, claimed.deltaElevM)
      );
    case "segment.entered":
    case "segment.exited":
      return (
        (claimed.type === "segment.entered" || claimed.type === "segment.exited") &&
        actual.segmentId === claimed.segmentId &&
        actual.tS === claimed.tS
      );
    case "lap.completed":
      return (
        claimed.type === "lap.completed" && actual.lap === claimed.lap && actual.tS === claimed.tS
      );
    case "ride.clockSkipped":
      return claimed.type === "ride.clockSkipped" && actual.skippedS === claimed.skippedS;
    default: {
      const exhaustive: never = actual;

      return exhaustive;
    }
  }
}

export function replayCommandEqual(
  actual: TrainerCommand,
  claimed: ReplayObservationV2["commands"][number] | undefined,
): boolean {
  if (claimed === undefined || actual.type !== claimed.type) {
    return false;
  }

  switch (actual.type) {
    case "simulation":
      return (
        claimed.type === "simulation" &&
        replayNumberEqual(actual.gradePct, claimed.gradePct) &&
        replayNumberEqual(actual.windMps, claimed.windMps) &&
        replayNumberEqual(actual.crr, claimed.crr) &&
        replayNumberEqual(actual.cwKgPerM, claimed.cwKgPerM)
      );
    case "targetPower":
      return claimed.type === "targetPower" && replayNumberEqual(actual.powerW, claimed.powerW);
    case "resistance":
      return claimed.type === "resistance" && replayNumberEqual(actual.level, claimed.level);
    default: {
      const exhaustive: never = actual;

      return exhaustive;
    }
  }
}
