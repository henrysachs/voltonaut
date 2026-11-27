import type { Meters } from "@voltonaut/shared";

import type { CenterlinePoint } from "../../elevation/route.js";

import { cumulativeLengths, type RoadPiece } from "./polyline.js";

/** Where a transition road starts or ends: a junction point with the road's heading there. */
export interface RoadEnd {
  readonly point: CenterlinePoint;
  readonly headingRad: number;
  readonly elevationM: Meters;
}

const DENSE_STEPS = 4096;

/** Tangent handles at a third of the gap give a gentle S or C without a kink at either end. */
const HANDLE_SHARE = 1 / 3;

function bezier(start: RoadEnd, end: RoadEnd): (t: number) => CenterlinePoint {
  const gapM = Math.hypot(end.point.x - start.point.x, end.point.z - start.point.z);
  const handleM = gapM * HANDLE_SHARE;

  const p1 = {
    x: start.point.x + Math.cos(start.headingRad) * handleM,
    z: start.point.z + Math.sin(start.headingRad) * handleM,
  };

  const p2 = {
    x: end.point.x - Math.cos(end.headingRad) * handleM,
    z: end.point.z - Math.sin(end.headingRad) * handleM,
  };

  return (t) => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;

    return {
      x: a * start.point.x + b * p1.x + c * p2.x + d * end.point.x,
      z: a * start.point.z + b * p1.z + c * p2.z + d * end.point.z,
    };
  };
}

/** Point at an arc distance along a dense polyline. */
function pointAlong(
  dense: readonly CenterlinePoint[],
  lengths: readonly number[],
  targetM: number,
): CenterlinePoint {
  const index = Math.max(
    0,
    lengths.findIndex((lengthM) => lengthM >= targetM),
  );

  const before = dense[Math.max(0, index - 1)] ?? { x: 0, z: 0 };
  const after = dense[index] ?? before;
  const fromM = lengths[Math.max(0, index - 1)] ?? 0;
  const spanM = (lengths[index] ?? fromM) - fromM;
  const share = spanM > 0 ? (targetM - fromM) / spanM : 0;

  return { x: before.x + share * (after.x - before.x), z: before.z + share * (after.z - before.z) };
}

/** Cosine ease: level at both junctions, steepest in the middle at π/2 · rise / length. */
function easedElevation(start: RoadEnd, end: RoadEnd, share: number): Meters {
  return (
    start.elevationM + ((1 - Math.cos(Math.PI * share)) / 2) * (end.elevationM - start.elevationM)
  );
}

/**
 * A smooth transition road between two junctions (ADR-033 step 3): a cubic Bézier that leaves
 * and enters along the given headings, resampled to chords of at most chordM, with one profile
 * sample per vertex. Both junction points are kept exactly.
 */
export function transitionRoad(start: RoadEnd, end: RoadEnd, chordM: Meters): RoadPiece {
  const curve = bezier(start, end);
  const dense = Array.from({ length: DENSE_STEPS + 1 }, (_, step) => curve(step / DENSE_STEPS));
  const denseLengths = cumulativeLengths(dense);
  const curveM = denseLengths.at(-1) ?? 0;
  const chords = Math.max(1, Math.ceil(curveM / chordM));

  const centerline = Array.from({ length: chords + 1 }, (_, step) =>
    step === 0
      ? start.point
      : step === chords
        ? end.point
        : pointAlong(dense, denseLengths, (step * curveM) / chords),
  );

  const lengths = cumulativeLengths(centerline);
  const lengthM = lengths.at(-1) ?? 0;

  return {
    centerline,
    lengthM,
    profileSamples: lengths.map((distanceM, step) => ({
      distanceM,
      elevationM:
        step === 0
          ? start.elevationM
          : step === chords
            ? end.elevationM
            : easedElevation(start, end, distanceM / lengthM),
    })),
  };
}
