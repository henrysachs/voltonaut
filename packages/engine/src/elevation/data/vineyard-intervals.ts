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

/**
 * Winding ring along the slopes: an elongated oval whose four gentle bulges read as terraced
 * vineyard roads. Radius of curvature stays far above the 62 m the smoothness check allows.
 */
function vineyardCurve(t: number): CenterlinePoint {
  const angleRad = t * Math.PI * 2;
  const wobble = 1 + 0.1 * Math.sin(angleRad * 4 + 0.6);

  return {
    x: Math.cos(angleRad) * 1150 * wobble,
    z: Math.sin(angleRad) * 1000 * wobble,
  };
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
