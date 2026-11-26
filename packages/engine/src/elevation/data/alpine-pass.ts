import type { CenterlinePoint, RouteData } from "../route.js";
import { polylineCenterline, sampledProfile, type PolylineLeg } from "./shapes.js";

const CLIMB_LENGTH_M = 12_000;
const CHORD_M = 10;
const LEG_CHORDS = 150;
const LEG_COUNT = 8;
const CORNER_CHORDS = 10;
const CORNER_STEP_RAD = Math.PI / 2 / CORNER_CHORDS;
const TURN_CHORDS = 73;
const SUMMIT_CONNECTOR_M = TURN_CHORDS * CHORD_M * 2;
const START_CONNECTOR_M = TURN_CHORDS * CHORD_M * 4;
const LENGTH_M = CLIMB_LENGTH_M * 2 + SUMMIT_CONNECTOR_M + START_CONNECTOR_M;
const SAMPLE_STEP_M = 10;
const SWITCHBACK_RAD = (45 * Math.PI) / 180;
const START_ELEVATION_M = 160;
const SUMMIT_ELEVATION_M = 1000;
const GRADE_PCT = 7;

/** Eight 1500 m legs with seven 100 m chamfered switchbacks instead of 90° vertices. */
function switchbackLegs(): readonly PolylineLeg[] {
  const legs: PolylineLeg[] = [];

  for (let index = 0; index < LEG_COUNT; index += 1) {
    const swingRad = index % 2 === 0 ? SWITCHBACK_RAD : -SWITCHBACK_RAD;
    const turnDirectionRad = index % 2 === 0 ? -1 : 1;

    legs.push({
      headingRad: swingRad,
      chordCount: index === LEG_COUNT - 1 ? LEG_CHORDS : LEG_CHORDS - CORNER_CHORDS,
    });

    if (index === LEG_COUNT - 1) continue;

    for (let chord = 1; chord <= CORNER_CHORDS; chord += 1) {
      legs.push({
        headingRad: swingRad + turnDirectionRad * CORNER_STEP_RAD * chord,
        chordCount: 1,
      });
    }
  }

  return legs;
}

function requiredPoint(points: readonly CenterlinePoint[]): CenterlinePoint {
  const point = points.at(-1);

  if (point === undefined) throw new RangeError("alpine centerline point is missing");

  return point;
}

/**
 * Closed out-and-back centerline. The return follows a separate corridor more
 * than two terrain half-widths from the climb; compact connectors turn around
 * outside the serpentine instead of teleporting or retracing the climb.
 */
function alpineCenterline(): readonly CenterlinePoint[] {
  const climb = polylineCenterline(switchbackLegs(), CHORD_M);
  const climbEnd = requiredPoint(climb);

  const summitTurn = polylineCenterline(
    [
      { headingRad: SWITCHBACK_RAD, chordCount: TURN_CHORDS },
      { headingRad: Math.PI - SWITCHBACK_RAD, chordCount: TURN_CHORDS },
    ],
    CHORD_M,
  )
    .slice(1)
    .map((point) => ({ x: climbEnd.x + point.x, z: climbEnd.z + point.z }));

  const summitEnd = requiredPoint(summitTurn);
  const returnOffsetZM = summitEnd.z - climbEnd.z;

  const descent = climb
    .toReversed()
    .slice(1)
    .map((point) => ({ x: point.x, z: point.z + returnOffsetZM }));

  const descentEnd = requiredPoint(descent);

  const startTurn = polylineCenterline(
    [
      { headingRad: -Math.PI + SWITCHBACK_RAD, chordCount: TURN_CHORDS * 2 },
      { headingRad: -SWITCHBACK_RAD, chordCount: TURN_CHORDS },
      { headingRad: SWITCHBACK_RAD, chordCount: TURN_CHORDS },
    ],
    CHORD_M,
  )
    .slice(1)
    .map((point) => ({ x: descentEnd.x + point.x, z: descentEnd.z + point.z }));

  const first = climb[0];

  if (first === undefined) throw new RangeError("alpine centerline start is missing");

  const points = [...climb, ...summitTurn, ...descent, ...startTurn];

  points[points.length - 1] = first;

  return points;
}

/** 7 % climb to the summit, then a steady descent back to the start elevation. */
function passElevationM(distanceM: number): number {
  if (distanceM <= CLIMB_LENGTH_M) {
    return START_ELEVATION_M + (distanceM / 100) * GRADE_PCT;
  }

  const descentFraction = (distanceM - CLIMB_LENGTH_M) / (LENGTH_M - CLIMB_LENGTH_M);

  return SUMMIT_ELEVATION_M - descentFraction * (SUMMIT_ELEVATION_M - START_ELEVATION_M);
}

/** Alpine Pass — 12 km serpentine climb with a separate descending return loop (#75). */
export const ALPINE_PASS: RouteData = {
  id: "alpine-pass",
  name: "Alpine Pass",
  lengthM: LENGTH_M,
  loop: true,
  centerline: alpineCenterline(),
  profileSamples: sampledProfile(LENGTH_M, SAMPLE_STEP_M, passElevationM),
  segments: [{ id: "pass-kom", name: "Pass KOM", kind: "kom", startM: 2000, endM: 12_000 }],
  scenery: "alpine",
};
