import type { CenterlinePoint } from "../../elevation/route.js";
import { closedLoopCenterline, sampledProfile } from "../../elevation/data/shapes.js";
import type { WorldData, WorldNode } from "../types.js";

const LENGTH_M = 9000;
const POINT_COUNT = 720;
const SAMPLE_STEP_M = 10;

const FLOOR_M = 140;
const RAMP_M = 200;
const CLIMB_M = 2000;

/** Grade where the climb starts and ends; the ramps ease from and to 0 % around it. */
const CLIMB_BASE_GRADE = 0.04;

/** Extra grade of the three quarry steps (sin⁴ peaks, so 4–7 % and a mean of 5.125 %). */
const CLIMB_STEP_GRADE = 0.03;
const CLIMB_STEPS = 3;

const RAMP_RISE_M = (CLIMB_BASE_GRADE * RAMP_M) / 2;
const CLIMB_RISE_M = CLIMB_M * (CLIMB_BASE_GRADE + (CLIMB_STEP_GRADE * 3) / 8);
const TOP_M = FLOOR_M + 2 * RAMP_RISE_M + CLIMB_RISE_M;

/**
 * Valley loop: an elongated oval, wider in the east than in the west, with a slight bend in
 * both long sides. Pure function of t; no randomness.
 */
function valleyCurve(t: number): CenterlinePoint {
  const angleRad = t * Math.PI * 2;

  return {
    x: 2100 * Math.cos(angleRad) - 120 * Math.cos(3 * angleRad),
    z: 640 * Math.sin(angleRad) + 130 * Math.sin(2 * angleRad) + 50 * Math.cos(3 * angleRad),
  };
}

/** Climbed share of a piece after the fraction u: ease(0) = 0, ease(1) = 1. */
type Ease = (u: number) => number;

/** Grade eases from 0 up to its peak along (1 − cos πu). */
const easeIn: Ease = (u) => u - Math.sin(Math.PI * u) / Math.PI;

/** Grade eases from its peak down to 0 along (1 + cos πu). */
const easeOut: Ease = (u) => u + Math.sin(Math.PI * u) / Math.PI;

/** Grade rises and falls back to 0 along (1 − cos 2πu). */
const easeInOut: Ease = (u) => u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);

/** ∫₀ˣ sin⁴. */
function sinPow4Integral(x: number): number {
  return (3 * x) / 8 - Math.sin(2 * x) / 4 + Math.sin(4 * x) / 32;
}

/** Grade CLIMB_BASE_GRADE + CLIMB_STEP_GRADE · sin⁴(CLIMB_STEPS · πu), normalized to CLIMB_RISE_M. */
const quarrySteps: Ease = (u) => {
  const frequency = CLIMB_STEPS * Math.PI;

  const riseFraction =
    CLIMB_BASE_GRADE * u + (CLIMB_STEP_GRADE * sinPow4Integral(frequency * u)) / frequency;

  return (riseFraction * CLIMB_M) / CLIMB_RISE_M;
};

const flat: Ease = () => 0;

/** One stretch of the lap: it ends at an absolute elevation, so the lap closes exactly. */
interface ProfilePiece {
  readonly lengthM: number;
  readonly toElevationM: number;
  readonly ease: Ease;
}

/** Valley floor, Steinbruch climb, plateau, descent and flat run-in; together LENGTH_M. */
const PIECES: readonly ProfilePiece[] = [
  { lengthM: 1000, toElevationM: FLOOR_M, ease: flat },
  { lengthM: RAMP_M, toElevationM: FLOOR_M + RAMP_RISE_M, ease: easeIn },
  { lengthM: CLIMB_M, toElevationM: TOP_M - RAMP_RISE_M, ease: quarrySteps },
  { lengthM: RAMP_M, toElevationM: TOP_M, ease: easeOut },
  { lengthM: 400, toElevationM: TOP_M, ease: flat },
  { lengthM: 3000, toElevationM: FLOOR_M, ease: easeInOut },
  { lengthM: 2200, toElevationM: FLOOR_M, ease: flat },
];

const STEINBRUCH_START_M = 1000 + RAMP_M;

function valleyElevationM(distanceM: number): number {
  let startM = 0;
  let fromM = FLOOR_M;

  for (const piece of PIECES) {
    const u = (distanceM - startM) / piece.lengthM;

    if (u <= 1) return fromM + (piece.toElevationM - fromM) * piece.ease(u);

    startM += piece.lengthM;
    fromM = piece.toElevationM;
  }

  throw new RangeError(`felsental has no elevation at ${distanceM} m`);
}

const CENTERLINE = closedLoopCenterline(valleyCurve, LENGTH_M, POINT_COUNT);

function startNode(): WorldNode {
  const start = CENTERLINE[0];

  if (start === undefined) throw new RangeError("felsental centerline is empty");

  return { id: "dorf", x: start.x, z: start.z, elevationM: FLOOR_M };
}

/**
 * Felsental: a 9 km stone-age valley loop with the 2 km Steinbruch climb (spec E10-16). A native
 * world, so createWorld checks its curvature and node elevations.
 */
export const FELSENTAL_WORLD: WorldData = {
  id: "felsental",
  name: "Felsental",
  revision: "1",
  regions: [{ id: "felsental", name: "Felsental", scenery: "stone-age" }],
  nodes: [startNode()],
  edges: [
    {
      id: "talrunde",
      regionId: "felsental",
      fromNodeId: "dorf",
      toNodeId: "dorf",
      lengthM: LENGTH_M,
      centerline: CENTERLINE,
      profileSamples: sampledProfile(LENGTH_M, SAMPLE_STEP_M, valleyElevationM),
    },
  ],
  paths: [
    {
      id: "felsental",
      name: "Felsental",
      loop: true,
      steps: [{ edgeId: "talrunde", direction: "forward" }],
      segments: [
        {
          id: "steinbruch",
          name: "Steinbruch",
          kind: "kom",
          startM: STEINBRUCH_START_M,
          endM: STEINBRUCH_START_M + CLIMB_M,
        },
      ],
    },
  ],
};
