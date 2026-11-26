import type { RouteData } from "../route.js";
import { polylineCenterline, sampledProfile, type PolylineLeg } from "./shapes.js";

const LENGTH_M = 12_000;
const CHORD_M = 10;
const LEG_CHORDS = 150;
const LEG_COUNT = 8;
const SAMPLE_STEP_M = 10;
const BASE_HEADING_RAD = 0;
const SWITCHBACK_RAD = (45 * Math.PI) / 180;
const START_ELEVATION_M = 160;
const GRADE_PCT = 7;

/** Eight legs of 1500 m that zigzag at ±45° around the valley axis: real serpentine. */
function switchbackLegs(): readonly PolylineLeg[] {
  const legs: PolylineLeg[] = [];

  for (let index = 0; index < LEG_COUNT; index += 1) {
    const swingRad = index % 2 === 0 ? SWITCHBACK_RAD : -SWITCHBACK_RAD;

    legs.push({ headingRad: BASE_HEADING_RAD + swingRad, chordCount: LEG_CHORDS });
  }

  return legs;
}

/** Constant 7 % climb from 160 m to 1000 m — 840 m of gain over the pass. */
function passElevationM(distanceM: number): number {
  return START_ELEVATION_M + (distanceM / 100) * GRADE_PCT;
}

/** Alpine Pass — 12 km serpentine climb through rock and snow (#75). */
export const ALPINE_PASS: RouteData = {
  id: "alpine-pass",
  name: "Alpine Pass",
  lengthM: LENGTH_M,
  loop: false,
  centerline: polylineCenterline(switchbackLegs(), CHORD_M),
  profileSamples: sampledProfile(LENGTH_M, SAMPLE_STEP_M, passElevationM),
  segments: [{ id: "pass-kom", name: "Pass KOM", kind: "kom", startM: 2000, endM: 10_000 }],
  scenery: "alpine",
};
