import { replayNumberEqual } from "@voltonaut/engine";
import type { ReplayObservationV2, RideEvent, TrainerCommand } from "@voltonaut/shared";

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
