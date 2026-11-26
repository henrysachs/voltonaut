import type { ElevationSample } from "../profile.js";
import type { CenterlinePoint } from "../route.js";

/** A point on a closed route curve; t = 0 and t = 1 identify the same place. */
export type RouteCurve = (t: number) => CenterlinePoint;

const MIN_DENSE_SAMPLE_COUNT = 1024;
const DENSE_SAMPLES_PER_POINT = 8;

function chordM(a: CenterlinePoint, b: CenterlinePoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function denseSamples(curve: RouteCurve, count: number): readonly CenterlinePoint[] {
  const samples: CenterlinePoint[] = [];

  for (let index = 0; index < count; index += 1) {
    samples.push(curve(index / count));
  }

  return samples;
}

/**
 * Cumulative chord lengths over a closed polyline. The final entry closes the
 * loop from the last sample back to the first, so lengths.at(-1) is the total.
 */
function cumulativeChordLengths(points: readonly CenterlinePoint[]): readonly number[] {
  const lengths: number[] = [0];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (previous === undefined || current === undefined) {
      throw new RangeError("curve points are missing");
    }

    lengths.push((lengths.at(-1) ?? 0) + chordM(previous, current));
  }

  const first = points[0];
  const last = points.at(-1);

  if (first === undefined || last === undefined) {
    throw new RangeError("curve points are missing");
  }

  lengths.push((lengths.at(-1) ?? 0) + chordM(last, first));

  return lengths;
}

/** Point on a closed polyline at targetM along its cumulative chord length. */
function pointAtArcLength(
  points: readonly CenterlinePoint[],
  lengths: readonly number[],
  targetM: number,
): CenterlinePoint {
  let low = 0;
  let high = lengths.length - 1;

  while (low < high - 1) {
    const mid = (low + high) >> 1;
    const midLength = lengths[mid] ?? 0;

    if (midLength <= targetM) low = mid;
    else high = mid;
  }

  const start = points[low];
  const end = points[low + 1] ?? points[0];
  const startLength = lengths[low] ?? 0;
  const endLength = lengths[low + 1] ?? startLength;
  const spanM = endLength - startLength;
  const fraction = spanM > 0 ? (targetM - startLength) / spanM : 0;

  if (start === undefined || end === undefined) {
    throw new RangeError("curve points are missing");
  }

  return {
    x: start.x + fraction * (end.x - start.x),
    z: start.z + fraction * (end.z - start.z),
  };
}

/**
 * Samples a closed route curve at pointCount places, evenly spaced by arc
 * length, and rescales the result so the chord arc length matches lengthM. The
 * final point repeats the first point exactly, so createRoute's loop closure
 * and arc length validation accept it.
 */
export function closedLoopCenterline(
  curve: RouteCurve,
  lengthM: number,
  pointCount: number,
): readonly CenterlinePoint[] {
  if (lengthM <= 0 || !Number.isFinite(lengthM)) {
    throw new RangeError("closed loop length must be positive and finite");
  }

  if (pointCount < 3) {
    throw new RangeError("a closed loop needs at least 3 curve points");
  }

  const denseCount = Math.max(pointCount * DENSE_SAMPLES_PER_POINT, MIN_DENSE_SAMPLE_COUNT);
  const curvePoints = denseSamples(curve, denseCount);
  const curveLengths = cumulativeChordLengths(curvePoints);
  const curveArcM = curveLengths.at(-1) ?? 0;

  if (curveArcM <= 0 || !Number.isFinite(curveArcM)) {
    throw new RangeError("a closed loop curve must have a positive finite arc length");
  }

  const scale = lengthM / curveArcM;
  const scaledPoints = curvePoints.map((point) => ({ x: point.x * scale, z: point.z * scale }));
  const scaledLengths = cumulativeChordLengths(scaledPoints);
  const stepM = lengthM / pointCount;
  const points: CenterlinePoint[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    points.push(pointAtArcLength(scaledPoints, scaledLengths, index * stepM));
  }

  const start = points[0];

  if (start === undefined) {
    throw new RangeError("curve points are missing");
  }

  points.push({ x: start.x, z: start.z });

  const coarseArcM = cumulativeChordLengths(points).at(-1) ?? 0;

  if (coarseArcM <= 0 || !Number.isFinite(coarseArcM)) {
    throw new RangeError("a closed loop curve must have a positive finite arc length");
  }

  const coarseScale = lengthM / coarseArcM;

  return points.map((point) => ({ x: point.x * coarseScale, z: point.z * coarseScale }));
}

export interface PolylineLeg {
  readonly headingRad: number;
  readonly chordCount: number;
}

/**
 * Polyline centerline starting at (0, 0): every leg advances exactly
 * chordCount chords of chordM meters along its heading, so the arc length is
 * the sum of all leg lengths by construction.
 */
export function polylineCenterline(
  legs: readonly PolylineLeg[],
  legChordM: number,
): readonly CenterlinePoint[] {
  if (legs.length === 0) {
    throw new RangeError("a polyline needs at least one leg");
  }

  const points: CenterlinePoint[] = [{ x: 0, z: 0 }];
  let x = 0;
  let z = 0;

  for (const leg of legs) {
    const advanceX = Math.cos(leg.headingRad) * legChordM;
    const advanceZ = Math.sin(leg.headingRad) * legChordM;

    for (let chord = 0; chord < leg.chordCount; chord += 1) {
      x += advanceX;
      z += advanceZ;
      points.push({ x, z });
    }
  }

  return points;
}

/**
 * Evenly spaced elevation samples from 0 to lengthM inclusive; lengthM must be
 * a whole multiple of stepM so the last sample lands exactly on the route end.
 */
export function sampledProfile(
  lengthM: number,
  stepM: number,
  elevationAt: (distanceM: number) => number,
): readonly ElevationSample[] {
  if (lengthM <= 0 || !Number.isFinite(lengthM) || lengthM % stepM !== 0) {
    throw new RangeError("profile length must be a positive whole multiple of the step");
  }

  const samples: ElevationSample[] = [];

  for (let distanceM = 0; distanceM <= lengthM; distanceM += stepM) {
    samples.push({ distanceM, elevationM: elevationAt(distanceM) });
  }

  return samples;
}
