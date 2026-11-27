import type { CenterlinePoint, RouteData } from "../route.js";
import { closedLoopCenterline, sampledProfile } from "./shapes.js";

const POINT_COUNT = 1000;
const SAMPLE_STEP_M = 10;
const BASE_ELEVATION_M = 140;

const DESCENT_GRADE_PCT = 3.5;

/** Length of the vertical curve that rounds every crest and valley. */
const CURVE_M = 60;

interface Ramp {
  readonly lengthM: number;
  readonly gradePct: number;
}

/** Nine interval ramps, 300–800 m at 3–7 %, in riding order from the lap line. */
const RAMPS: readonly Ramp[] = [
  { lengthM: 500, gradePct: 4 },
  { lengthM: 700, gradePct: 5 },
  { lengthM: 350, gradePct: 6.5 },
  { lengthM: 800, gradePct: 3.5 },
  { lengthM: 600, gradePct: 5.5 },
  { lengthM: 450, gradePct: 6.8 },
  { lengthM: 750, gradePct: 4.5 },
  { lengthM: 400, gradePct: 6 },
  { lengthM: 650, gradePct: 3.8 },
];

interface Leg {
  readonly startM: number;
  readonly endM: number;
  readonly startElevationM: number;
  readonly endElevationM: number;
}

/**
 * Ramp, then a descent that returns to the base height, repeated for every ramp; the descent
 * length follows from the ramp's rise at about DESCENT_GRADE_PCT. Both ends of the lap sit on
 * the base height, so the profile closes without a step.
 */
function legs(): readonly Leg[] {
  const result: Leg[] = [];
  let distanceM = 0;

  for (const ramp of RAMPS) {
    const riseM = (ramp.lengthM * ramp.gradePct) / 100;
    const descentM = Math.round(riseM / (DESCENT_GRADE_PCT / 100) / SAMPLE_STEP_M) * SAMPLE_STEP_M;
    const topM = BASE_ELEVATION_M + riseM;

    result.push(
      {
        startM: distanceM,
        endM: distanceM + ramp.lengthM,
        startElevationM: BASE_ELEVATION_M,
        endElevationM: topM,
      },
      {
        startM: distanceM + ramp.lengthM,
        endM: distanceM + ramp.lengthM + descentM,
        startElevationM: topM,
        endElevationM: BASE_ELEVATION_M,
      },
    );
    distanceM += ramp.lengthM + descentM;
  }

  return result;
}

const LEGS = legs();
const LENGTH_M = LEGS.at(-1)?.endM ?? 0;

function legElevationM(distanceM: number): number {
  const leg = LEGS.find((candidate) => distanceM <= candidate.endM);

  if (leg === undefined) return BASE_ELEVATION_M;

  const share = (distanceM - leg.startM) / (leg.endM - leg.startM);

  return leg.startElevationM + share * (leg.endElevationM - leg.startElevationM);
}

function gradeOf(leg: Leg | undefined): number {
  return leg === undefined
    ? 0
    : (leg.endElevationM - leg.startElevationM) / (leg.endM - leg.startM);
}

/**
 * The profile with a vertical curve of CURVE_M at every change of grade: a parabola that meets
 * both legs, so crests and valleys are rounded and the lap line closes without a step.
 */
function elevationM(distanceM: number): number {
  for (let index = 0; index <= LEGS.length; index += 1) {
    const next = LEGS[index % LEGS.length];
    const previous = LEGS[(index - 1 + LEGS.length) % LEGS.length];
    const boundaryM = index === LEGS.length ? LENGTH_M : (next?.startM ?? 0);
    const offsetM = distanceM - boundaryM;

    if (Math.abs(offsetM) <= CURVE_M / 2) {
      const before = gradeOf(previous);
      const after = gradeOf(next);

      return (
        (next?.startElevationM ?? BASE_ELEVATION_M) +
        before * offsetM +
        ((after - before) / (2 * CURVE_M)) * (offsetM + CURVE_M / 2) ** 2
      );
    }
  }

  return legElevationM(distanceM);
}

/** Distance between the centres of the two end bends, before the loop is scaled to its length. */
const STRAIGHT_M = 4776;

/** Radius of the end bends: wide hairpins at both ends of the long oval. */
const BEND_RADIUS_M = 500;

/** Height of the terrace wobbles on the long sides; they fade out into the bends. */
const WOBBLE_M = 60;

/** Wobbles along the upper and the lower side; whole or half counts end without a kink. */
const UPPER_WOBBLES = 4;
const LOWER_WOBBLES = 4.5;

/** The oval runs east-south-east, so its east end keeps 1.8 km from the coast loop. */
const TILT_RAD = (-10.3 * Math.PI) / 180;

const OVAL_M = 2 * STRAIGHT_M + 2 * Math.PI * BEND_RADIUS_M;

/** Sideways offset of a long side at a share of its length: zero, and level, at both ends. */
function wobbleM(share: number, count: number): number {
  return WOBBLE_M * Math.sin(2 * Math.PI * count * share) * Math.sin(Math.PI * share);
}

function bendPoint(centreX: number, angleRad: number): CenterlinePoint {
  return {
    x: centreX + Math.cos(angleRad) * BEND_RADIUS_M,
    z: Math.sin(angleRad) * BEND_RADIUS_M,
  };
}

/** Point of the untilted oval, distanceM counter-clockwise from its east tip. */
function ovalPoint(distanceM: number): CenterlinePoint {
  const eastX = STRAIGHT_M / 2;
  const upperM = distanceM - (Math.PI * BEND_RADIUS_M) / 2;
  const westM = upperM - STRAIGHT_M;
  const lowerM = westM - Math.PI * BEND_RADIUS_M;
  const backM = lowerM - STRAIGHT_M;

  if (upperM < 0) return bendPoint(eastX, distanceM / BEND_RADIUS_M);

  if (westM < 0) {
    const share = upperM / STRAIGHT_M;

    return { x: eastX - share * STRAIGHT_M, z: BEND_RADIUS_M + wobbleM(share, UPPER_WOBBLES) };
  }

  if (lowerM < 0) return bendPoint(-eastX, Math.PI / 2 + westM / BEND_RADIUS_M);

  if (backM < 0) {
    const share = lowerM / STRAIGHT_M;

    return { x: share * STRAIGHT_M - eastX, z: -BEND_RADIUS_M - wobbleM(share, LOWER_WOBBLES) };
  }

  return bendPoint(eastX, (3 * Math.PI) / 2 + backM / BEND_RADIUS_M);
}

/**
 * Winding ring along the slopes: a long oval with wide bends at both ends and gentle wobbles
 * on its long sides that read as terraced vineyard roads. It stays narrow, so the world around
 * it stays small (the terrain raster covers the world's bounding box).
 */
function vineyardCurve(t: number): CenterlinePoint {
  const point = ovalPoint(t * OVAL_M);
  const cos = Math.cos(TILT_RAD);
  const sin = Math.sin(TILT_RAD);

  return { x: point.x * cos - point.z * sin, z: point.x * sin + point.z * cos };
}

/** The ramp that carries the KOM segment: the second, 700 m at 5 %. */
const KOM_LEG = LEGS[2];

/**
 * Weinberg-Intervalle — 12.4 km loop of nine short ramps (300–800 m, 3–7 %) with descents
 * between them, for interval work (#146). Pure function of its constants; no randomness.
 */
export const VINEYARD_INTERVALS: RouteData = {
  id: "vineyard-intervals",
  name: "Weinberg-Intervalle",
  lengthM: LENGTH_M,
  loop: true,
  centerline: closedLoopCenterline(vineyardCurve, LENGTH_M, POINT_COUNT),
  profileSamples: sampledProfile(LENGTH_M, SAMPLE_STEP_M, elevationM),
  segments: [
    {
      id: "rebhang-kom",
      name: "Rebhang KOM",
      kind: "kom",
      startM: KOM_LEG?.startM ?? 0,
      endM: KOM_LEG?.endM ?? 0,
    },
  ],
  scenery: "vineyard",
};
