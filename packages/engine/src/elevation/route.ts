import type { Meters } from "@voltonaut/shared";

import type { ElevationProfile, ElevationSample } from "./profile.js";
import { createElevationProfile } from "./profile.js";

/** 2D centerline control point in the XZ plane; Y comes from the elevation profile. */
export interface CenterlinePoint {
  readonly x: number;
  readonly z: number;
}

export type SegmentKind = "sprint" | "kom" | "lap";

export interface SegmentDef {
  readonly id: string;
  readonly name: string;
  readonly kind: SegmentKind;
  readonly startM: Meters;
  readonly endM: Meters;
}

/** Pure route data; E3 ships three test routes as data files under data/. */
export interface RouteData {
  readonly id: string;
  readonly name: string;
  readonly lengthM: Meters;
  readonly loop: boolean;
  readonly centerline: readonly CenterlinePoint[];
  readonly profileSamples: readonly ElevationSample[];
  readonly segments: readonly SegmentDef[];
  readonly scenery: string;
}

export interface WorldPos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EngineRoute {
  readonly id: string;
  readonly name: string;
  readonly lengthM: Meters;
  readonly loop: boolean;
  readonly profile: ElevationProfile;
  readonly segments: readonly SegmentDef[];
  readonly scenery: string;
  /** Position along the centerline; loops wrap at lengthM, non-loops clamp at lengthM. */
  readonly worldPos: (distanceM: Meters) => WorldPos;
  /** Heading of the centerline segment containing the position, in radians. */
  readonly headingRad: (distanceM: Meters) => number;
}

const ARC_LENGTH_TOLERANCE_M = 1e-6;

function cumulativeLengths(points: readonly CenterlinePoint[]): number[] {
  const lengths: number[] = [0];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (previous === undefined || current === undefined) {
      throw new RangeError("centerline point is missing");
    }

    const previousLength = lengths.at(-1) ?? 0;

    lengths.push(previousLength + Math.hypot(current.x - previous.x, current.z - previous.z));
  }

  return lengths;
}

function wrapDistanceM(distanceM: Meters, lengthM: Meters): Meters {
  return ((distanceM % lengthM) + lengthM) % lengthM;
}

function clampDistanceM(distanceM: Meters, lengthM: Meters): Meters {
  return Math.min(lengthM, Math.max(0, distanceM));
}

/** Largest index i with lengths[i] <= d, bounded to [0, count - 2]. */
function segmentIndexFor(lengths: readonly number[], distanceM: Meters): number {
  let low = 0;
  let high = lengths.length - 1;

  while (low < high - 1) {
    const mid = (low + high) >> 1;
    const midLength = lengths[mid] ?? 0;

    if (midLength <= distanceM) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

function pointsEqual(a: CenterlinePoint, b: CenterlinePoint): boolean {
  return a.x === b.x && a.z === b.z;
}

function validateCenterline(data: RouteData): readonly number[] {
  const { lengthM, loop } = data;

  if (lengthM <= 0 || !Number.isFinite(lengthM)) {
    throw new RangeError("route lengthM must be positive and finite");
  }

  if (data.centerline.length < 2) {
    throw new RangeError("a route needs at least 2 centerline points");
  }

  const firstPoint = data.centerline[0];
  const lastPoint = data.centerline.at(-1);

  if (firstPoint === undefined || lastPoint === undefined) {
    throw new RangeError("centerline points are missing");
  }

  if (loop && !pointsEqual(firstPoint, lastPoint)) {
    throw new RangeError("a loop centerline must close exactly (first point equals last point)");
  }

  const arcLengths = cumulativeLengths(data.centerline);
  const totalArcM = arcLengths.at(-1) ?? 0;

  if (Math.abs(totalArcM - lengthM) > ARC_LENGTH_TOLERANCE_M) {
    throw new RangeError(
      `centerline arc length ${totalArcM} does not match route lengthM ${lengthM}`,
    );
  }

  return arcLengths;
}

function validateSegments(segments: readonly SegmentDef[], lengthM: Meters): void {
  const segmentIds = new Set<string>();

  for (const segment of segments) {
    if (segmentIds.has(segment.id)) {
      throw new RangeError(`duplicate segment id ${segment.id}`);
    }

    segmentIds.add(segment.id);

    if (
      segment.startM >= segment.endM ||
      !Number.isFinite(segment.startM) ||
      !Number.isFinite(segment.endM) ||
      segment.endM > lengthM ||
      segment.startM < 0
    ) {
      throw new RangeError(`segment ${segment.id} is outside the route`);
    }
  }
}

function worldPosition(
  data: RouteData,
  profile: ElevationProfile,
  arcLengths: readonly number[],
  positionM: Meters,
): WorldPos {
  const index = segmentIndexFor(arcLengths, positionM);
  const startLength = arcLengths[index] ?? 0;
  const endLength = arcLengths[index + 1] ?? startLength;
  const start = data.centerline[index];
  const end = data.centerline[index + 1] ?? data.centerline[index];

  if (start === undefined || end === undefined) {
    return {
      x: data.centerline[0]?.x ?? 0,
      y: profile.elevationAt(positionM),
      z: data.centerline[0]?.z ?? 0,
    };
  }

  const spanM = endLength - startLength;
  const fraction = spanM > 0 ? (positionM - startLength) / spanM : 0;

  return {
    x: start.x + fraction * (end.x - start.x),
    y: profile.elevationAt(positionM),
    z: start.z + fraction * (end.z - start.z),
  };
}

/** Validates route data and derives the immutable EngineRoute (arc lengths at construction). */
export function createRoute(data: RouteData): EngineRoute {
  const { lengthM, loop } = data;
  const arcLengths = validateCenterline(data);
  const profile = createElevationProfile(data.profileSamples, { loop });

  if (profile.lengthM !== lengthM) {
    throw new RangeError(
      `elevation profile length ${profile.lengthM} does not match route lengthM`,
    );
  }

  validateSegments(data.segments, lengthM);

  return {
    id: data.id,
    name: data.name,
    lengthM,
    loop,
    profile,
    segments: data.segments,
    scenery: data.scenery,
    worldPos(distanceM: Meters): WorldPos {
      const positionM = loop
        ? wrapDistanceM(distanceM, lengthM)
        : clampDistanceM(distanceM, lengthM);

      return worldPosition(data, profile, arcLengths, positionM);
    },
    headingRad(distanceM: Meters): number {
      const positionM = loop
        ? wrapDistanceM(distanceM, lengthM)
        : clampDistanceM(distanceM, lengthM);

      const index = segmentIndexFor(arcLengths, positionM);
      const start = data.centerline[index];
      const end = data.centerline[index + 1] ?? data.centerline[0];

      if (start === undefined || end === undefined) {
        return 0;
      }

      return Math.atan2(end.z - start.z, end.x - start.x);
    },
  };
}
