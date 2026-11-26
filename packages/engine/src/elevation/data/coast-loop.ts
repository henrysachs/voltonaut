import type { CenterlinePoint, RouteData } from "../route.js";
import { closedLoopCenterline, sampledProfile } from "./shapes.js";

const LENGTH_M = 8000;
const POINT_COUNT = 640;
const SAMPLE_STEP_M = 10;

/**
 * Coastal ring: an elongated egg with a wavy shore on one side, so the loop
 * reads as a seaside promenade. Pure function of t; no randomness.
 */
function coastCurve(t: number): CenterlinePoint {
  const angleRad = t * Math.PI * 2;
  const wobble = 1 + 0.18 * Math.sin(angleRad * 3);

  return {
    x: Math.cos(angleRad) * 1500 * wobble,
    z: Math.sin(angleRad) * 620 * wobble,
  };
}

/**
 * Gently rolling dunes under 2 % grade. Both sines close over LENGTH_M
 * (1000 m and 500 m divide 8000), so the profile is seamless at the lap line.
 */
function duneElevationM(distanceM: number): number {
  const longWave = 1.5 * Math.sin((distanceM / 1000) * Math.PI * 2);
  const shortWave = 0.4 * Math.sin((distanceM / 500) * Math.PI * 2 + 1.1);

  return 4 + longWave + shortWave;
}

/** Coast Loop — 8 km flat seaside ring with palms, sand and a lighthouse (#75). */
export const COAST_LOOP: RouteData = {
  id: "coast-loop",
  name: "Coast Loop",
  lengthM: LENGTH_M,
  loop: true,
  centerline: closedLoopCenterline(coastCurve, LENGTH_M, POINT_COUNT),
  profileSamples: sampledProfile(LENGTH_M, SAMPLE_STEP_M, duneElevationM),
  segments: [
    { id: "boardwalk-sprint", name: "Boardwalk Sprint", kind: "sprint", startM: 1200, endM: 2700 },
  ],
  scenery: "coast",
};
