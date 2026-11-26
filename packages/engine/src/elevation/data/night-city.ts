import type { CenterlinePoint, RouteData } from "../route.js";
import { closedLoopCenterline, sampledProfile } from "./shapes.js";

const LENGTH_M = 6000;
const POINT_COUNT = 480;
const SAMPLE_STEP_M = 10;

/** Cube root keeps the sign, so the superellipse stays symmetric in all quadrants. */
function cubeRoot(value: number): number {
  return Math.cbrt(Math.abs(value)) * Math.sign(value);
}

/**
 * City block ring: a superellipse with exponent 6 — flat sides along the
 * avenues, rounded corners at the intersections. Pure function of t.
 */
function cityCurve(t: number): CenterlinePoint {
  const angleRad = t * Math.PI * 2;
  const along = Math.cos(angleRad);
  const across = Math.sin(angleRad);

  return { x: 1250 * cubeRoot(along), z: 640 * cubeRoot(across) };
}

/** Almost flat streets; the 375 m wave closes over LENGTH_M for a seamless lap. */
function streetElevationM(distanceM: number): number {
  return 12 + 0.8 * Math.sin((distanceM / 375) * Math.PI * 2);
}

/** Night City — 6 km flat neon loop through a dark downtown (#75). */
export const NIGHT_CITY: RouteData = {
  id: "night-city",
  name: "Night City",
  lengthM: LENGTH_M,
  loop: true,
  centerline: closedLoopCenterline(cityCurve, LENGTH_M, POINT_COUNT),
  profileSamples: sampledProfile(LENGTH_M, SAMPLE_STEP_M, streetElevationM),
  segments: [{ id: "neon-sprint", name: "Neon Sprint", kind: "sprint", startM: 800, endM: 1800 }],
  scenery: "night-city",
};
