import { z } from "zod";

/**
 * Standalone route of a stored ride from before connected worlds (ADR-033 §8). Stays readable;
 * new rides never write it.
 */
export interface LegacyRouteReference {
  readonly routeId: string;
  readonly routeRevision: string;
}

/**
 * Driven path of a ride (ADR-033 §7). A world revision is immutable, so the path id names exactly
 * one sequence of edges with direction, its loop flag and its segments.
 */
export interface WorldPathReference {
  readonly worldId: string;
  readonly worldRevision: string;
  readonly pathId: string;
}

/** Exactly one of both forms, flat next to the other ride fields; stored rows have no tag. */
export type RideReference = LegacyRouteReference | WorldPathReference;

/** Contract fields by name, as z.object takes them. */
interface ContractFields {
  readonly [field: string]: z.ZodTypeAny;
}

/**
 * Strict union of the given fields with exactly one complete reference form. The reference sits
 * between `before` and `after`, where routeId/routeRevision always stood: parsed output keeps the
 * stored key order, so payload hashes of stored rows stay stable.
 */
export function withRideReference<B extends ContractFields, A extends ContractFields>(
  before: B,
  after: A,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Zod schemas are immutable builders with mutable internal metadata.
  text: z.ZodString,
) {
  return z.union([
    z
      .object({ ...before, worldId: text, worldRevision: text, pathId: text, ...after })
      .strict()
      .readonly(),
    z
      .object({ ...before, routeId: text, routeRevision: text, ...after })
      .strict()
      .readonly(),
  ]);
}

export function isWorldPathReference(reference: RideReference): reference is WorldPathReference {
  return "worldId" in reference;
}

/** Copies only the reference fields of a parsed contract value. */
export function rideReferenceOf(value: RideReference): RideReference {
  return isWorldPathReference(value)
    ? { worldId: value.worldId, worldRevision: value.worldRevision, pathId: value.pathId }
    : { routeId: value.routeId, routeRevision: value.routeRevision };
}

export function sameRideReference(left: RideReference, right: RideReference): boolean {
  if (isWorldPathReference(left)) {
    return (
      isWorldPathReference(right) &&
      left.worldId === right.worldId &&
      left.worldRevision === right.worldRevision &&
      left.pathId === right.pathId
    );
  }

  return (
    !isWorldPathReference(right) &&
    left.routeId === right.routeId &&
    left.routeRevision === right.routeRevision
  );
}

/** Human-readable reference for export notes; the legacy wording stays unchanged. */
export function describeRideReference(reference: RideReference): string {
  return isWorldPathReference(reference)
    ? `World ${reference.worldId}, revision ${reference.worldRevision}, path ${reference.pathId}`
    : `Route ${reference.routeId}, revision ${reference.routeRevision}`;
}
