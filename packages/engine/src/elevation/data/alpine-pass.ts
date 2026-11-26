import type { CenterlinePoint, RouteData } from "../route.js";
import { polylineCenterline, sampledProfile, type PolylineLeg } from "./shapes.js";

const CHORD_M = 10;
const LEG_CHORDS = 150;
const LEG_COUNT = 8;
const CROSSING_CHORDS = 60;
const CLIMB_M = LEG_COUNT * LEG_CHORDS * CHORD_M;
const CROSSING_M = CROSSING_CHORDS * CHORD_M;
const LENGTH_M = 2 * (CLIMB_M + CROSSING_M);
const SAMPLE_STEP_M = 10;
const SWITCHBACK_RAD = (45 * Math.PI) / 180;
const START_ELEVATION_M = 160;
const GRADE_PCT = 7;
const SUMMIT_ELEVATION_M = START_ELEVATION_M + (CLIMB_M / 100) * GRADE_PCT;
/** Floating-point drift the closed polyline may carry before the last point is snapped shut. */
const CLOSURE_TOLERANCE_M = 1e-6;

/** Eight 1500 m legs that zigzag at ±45° around a valley axis: a real serpentine. */
function switchbackLegs(axisRad: number, firstSwingRad: number): readonly PolylineLeg[] {
  const legs: PolylineLeg[] = [];

  for (let index = 0; index < LEG_COUNT; index += 1) {
    const swingRad = index % 2 === 0 ? firstSwingRad : -firstSwingRad;

    legs.push({ headingRad: axisRad + swingRad, chordCount: LEG_CHORDS });
  }

  return legs;
}

/**
 * A pass crossed in both directions as one loop: switchbacks up the north flank, 600 m over the
 * saddle, a second serpentine 600 m to the south back down, and 600 m across the valley floor to
 * the start. The two serpentines never share road.
 */
function passLoopCenterline(): readonly CenterlinePoint[] {
  const points = polylineCenterline(
    [
      ...switchbackLegs(0, SWITCHBACK_RAD),
      { headingRad: -Math.PI / 2, chordCount: CROSSING_CHORDS },
      ...switchbackLegs(Math.PI, SWITCHBACK_RAD),
      { headingRad: Math.PI / 2, chordCount: CROSSING_CHORDS },
    ],
    CHORD_M,
  );

  const last = points.at(-1);

  if (last === undefined || Math.hypot(last.x, last.z) > CLOSURE_TOLERANCE_M) {
    throw new RangeError("the alpine pass loop must return to its start");
  }

  return [...points.slice(0, -1), { x: 0, z: 0 }];
}

/** 7 % up to the saddle, flat across it, 7 % down, flat back across the valley floor. */
function passElevationM(distanceM: number): number {
  if (distanceM <= CLIMB_M) return START_ELEVATION_M + (distanceM / 100) * GRADE_PCT;

  if (distanceM <= CLIMB_M + CROSSING_M) return SUMMIT_ELEVATION_M;

  const descentM = Math.min(distanceM - CLIMB_M - CROSSING_M, CLIMB_M);

  return SUMMIT_ELEVATION_M - (descentM / 100) * GRADE_PCT;
}

/**
 * Alpine Pass — a 25.2 km loop over a pass: 840 m up a serpentine through rock and snow, down a
 * second one on the far flank (#75). A loop has no route end, so the ride never runs into one.
 */
export const ALPINE_PASS: RouteData = {
  id: "alpine-pass",
  name: "Alpine Pass",
  lengthM: LENGTH_M,
  loop: true,
  centerline: passLoopCenterline(),
  profileSamples: sampledProfile(LENGTH_M, SAMPLE_STEP_M, passElevationM),
  segments: [{ id: "pass-kom", name: "Pass KOM", kind: "kom", startM: 2000, endM: 10_000 }],
  scenery: "alpine",
};
