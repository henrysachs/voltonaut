import {
  createRideProgressProjector,
  rideReferenceOf,
  type NativeTickFacts,
  type RideProgressCheckpoint,
  type RideProgressMetadata,
  type RideProgressProjector,
  type RiderProfile,
  type WorldPathReference,
} from "@voltonaut/shared";
import { PHYSICS_REVISION, riderParamsFromProfile } from "@voltonaut/engine";

export interface EngineWorkerProgress {
  readonly projector: RideProgressProjector;
  readonly metadata: RideProgressMetadata;
}

export function createEngineWorkerProgress({
  source,
  clockScale,
  worldPath,
  profile,
  newId,
}: {
  readonly source: "sim" | "ble";
  readonly clockScale: number;
  readonly worldPath: WorldPathReference;
  readonly profile: RiderProfile;
  readonly newId: () => string;
}): EngineWorkerProgress {
  return {
    projector: createRideProgressProjector(),
    metadata: {
      journalId: newId(),
      source,
      clockScale,
      physicsRevision: PHYSICS_REVISION,
      ...rideReferenceOf(worldPath),
      physics: riderParamsFromProfile(profile),
    },
  };
}

export function projectEngineWorkerProgress(
  progress: EngineWorkerProgress,
  {
    startedAtMs,
    endedAtMs,
    facts,
    paused,
    dataAgeS,
    clockSkipped,
  }: {
    readonly startedAtMs: number | undefined;
    readonly endedAtMs: number;
    readonly facts: readonly NativeTickFacts[];
    readonly paused: boolean;
    readonly dataAgeS: number;
    readonly clockSkipped: boolean;
  },
): RideProgressCheckpoint | undefined {
  return startedAtMs === undefined
    ? undefined
    : progress.projector.push({
        ...progress.metadata,
        startedAtMs,
        endedAtMs,
        facts,
        quality: { paused, dataAgeS, clockSkipped },
      });
}
