import { sameRideReference, type RideProgressMetadata } from "@voltonaut/shared";

function hasSamePhysics(
  left: Readonly<RideProgressMetadata["physics"]>,
  right: Readonly<RideProgressMetadata["physics"]>,
): boolean {
  return (
    left.massKg === right.massKg &&
    left.bikeMassKg === right.bikeMassKg &&
    left.cdaM2 === right.cdaM2 &&
    left.crr === right.crr &&
    left.wheelCircM === right.wheelCircM
  );
}

/** Immutable checkpoint metadata of one journal, including its ride reference (ADR-033 §7). */
export function hasSameMetadata(
  left: Readonly<RideProgressMetadata>,
  right: Readonly<RideProgressMetadata>,
): boolean {
  return (
    left.journalId === right.journalId &&
    left.source === right.source &&
    left.clockScale === right.clockScale &&
    left.physicsRevision === right.physicsRevision &&
    sameRideReference(left, right) &&
    hasSamePhysics(left.physics, right.physics)
  );
}
