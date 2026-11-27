import type { Meters } from "@voltonaut/shared";

import type { ElevationSample } from "../../elevation/profile.js";
import type { CenterlinePoint } from "../../elevation/route.js";

/** A drivable piece of road: chords plus its profile from 0 to lengthM (ADR-033 §2). */
export interface RoadPiece {
  readonly centerline: readonly CenterlinePoint[];
  readonly profileSamples: readonly ElevationSample[];
  readonly lengthM: Meters;
}

/** Samples closer than this to a cut are dropped so profile distances stay strictly increasing. */
const CUT_GAP_M = 1e-6;

/** Cumulative chord lengths, summed in order like the edge validation does. */
export function cumulativeLengths(points: readonly CenterlinePoint[]): readonly number[] {
  const lengths: number[] = [0];
  let previous = points[0];

  for (const point of points.slice(1)) {
    const lastM = lengths.at(-1) ?? 0;

    lengths.push(lastM + Math.hypot(point.x - (previous?.x ?? 0), point.z - (previous?.z ?? 0)));
    previous = point;
  }

  return lengths;
}

/** Linear profile interpolation; distances must lie inside the sampled range. */
export function elevationAt(samples: readonly ElevationSample[], distanceM: Meters): Meters {
  let low = 0;
  let high = samples.length - 1;

  while (low < high - 1) {
    const mid = (low + high) >> 1;

    if ((samples[mid]?.distanceM ?? 0) <= distanceM) low = mid;
    else high = mid;
  }

  const start = samples[low];
  const end = samples[high];

  if (start === undefined || end === undefined) {
    throw new RangeError("profile samples are missing");
  }

  const spanM = end.distanceM - start.distanceM;

  return spanM > 0
    ? start.elevationM +
        ((distanceM - start.distanceM) / spanM) * (end.elevationM - start.elevationM)
    : start.elevationM;
}

/** A closed or open road the pieces are cut from; closed roads repeat their first point last. */
export interface SourceRoad {
  readonly centerline: readonly CenterlinePoint[];
  readonly profileSamples: readonly ElevationSample[];
  readonly closed: boolean;
}

interface Unrolled {
  readonly point: (index: number) => CenterlinePoint;
  readonly distanceM: (index: number) => number;
  readonly elevationM: (distanceM: number) => number;
  readonly samples: (fromM: number, toM: number) => readonly ElevationSample[];
}

/** Index space of a road; a closed road continues past its end into the next lap. */
function unroll(road: SourceRoad): Unrolled {
  const points = road.centerline;
  const lengths = cumulativeLengths(points);
  const count = points.length - 1;
  const lapM = lengths.at(-1) ?? 0;
  const lap = (index: number): number => (road.closed ? Math.floor(index / count) : 0);
  const local = (index: number): number => index - lap(index) * count;

  return {
    point: (index) => points[local(index)] ?? { x: 0, z: 0 },
    distanceM: (index) => (lengths[local(index)] ?? 0) + lap(index) * lapM,
    elevationM: (distanceM) =>
      elevationAt(road.profileSamples, road.closed ? distanceM % lapM : distanceM),
    samples: (fromM, toM) =>
      [0, lapM].flatMap((offsetM) =>
        road.profileSamples.flatMap((sample): readonly ElevationSample[] => {
          const distanceM = sample.distanceM + offsetM;
          const inLap = offsetM === 0 || (road.closed && distanceM > offsetM);
          const inside = distanceM > fromM + CUT_GAP_M && distanceM < toM - CUT_GAP_M;

          return inLap && inside ? [{ distanceM, elevationM: sample.elevationM }] : [];
        }),
      ),
  };
}

/**
 * Cuts the road between two vertex indices (toIndex > fromIndex; a closed road may wrap once).
 * Both ends are interpolated from the source profile, so pieces cut at the same vertex share
 * the same elevation; the last sample sits exactly at the piece's own chord length.
 */
export function cutPiece(road: SourceRoad, fromIndex: number, toIndex: number): RoadPiece {
  const count = road.centerline.length - 1;

  if (toIndex <= fromIndex || toIndex - fromIndex > count || (!road.closed && toIndex > count)) {
    throw new RangeError(`cannot cut road from vertex ${fromIndex} to ${toIndex}`);
  }

  const source = unroll(road);

  const centerline = Array.from({ length: toIndex - fromIndex + 1 }, (_, step) =>
    source.point(fromIndex + step),
  );

  const lengthM = cumulativeLengths(centerline).at(-1) ?? 0;
  const fromM = source.distanceM(fromIndex);
  const toM = source.distanceM(toIndex);

  const inner = source.samples(fromM, toM).map((sample) => ({
    distanceM: sample.distanceM - fromM,
    elevationM: sample.elevationM,
  }));

  return {
    centerline,
    lengthM,
    profileSamples: [
      { distanceM: 0, elevationM: source.elevationM(fromM) },
      ...inner,
      { distanceM: lengthM, elevationM: source.elevationM(toM) },
    ],
  };
}

/** Heading of the chord that leaves a vertex, in radians. */
export function chordHeadingRad(points: readonly CenterlinePoint[], index: number): number {
  const from = points[index];
  const to = points[index + 1];

  if (from === undefined || to === undefined) {
    throw new RangeError(`no chord leaves vertex ${index}`);
  }

  return Math.atan2(to.z - from.z, to.x - from.x);
}

function angleBetween(aRad: number, bRad: number): number {
  return Math.abs(Math.atan2(Math.sin(aRad - bRad), Math.cos(aRad - bRad)));
}

/** Vertex whose leaving chord points closest to the heading; ties keep the first vertex. */
export function vertexFacing(points: readonly CenterlinePoint[], headingRad: number): number {
  let best = 0;
  let bestRad = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const offRad = angleBetween(chordHeadingRad(points, index), headingRad);

    if (offRad < bestRad) {
      best = index;
      bestRad = offRad;
    }
  }

  return best;
}
