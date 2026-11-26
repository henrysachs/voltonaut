import { expect, it } from "vitest";

import { createRoute, type RouteData } from "../route.js";
import { ALPINE_PASS } from "./alpine-pass.js";
import { COAST_LOOP } from "./coast-loop.js";
import { NIGHT_CITY } from "./night-city.js";

function chordLengthsM(data: Readonly<typeof COAST_LOOP>): readonly number[] {
  const lengths: number[] = [];

  for (let index = 1; index < data.centerline.length; index += 1) {
    const previous = data.centerline[index - 1];
    const current = data.centerline[index];

    if (previous === undefined || current === undefined) {
      throw new RangeError("centerline point is missing");
    }

    lengths.push(Math.hypot(current.x - previous.x, current.z - previous.z));
  }

  return lengths;
}

function assertSampleSpacing(data: Readonly<typeof COAST_LOOP>): void {
  expect(data.profileSamples.at(0)?.distanceM).toBe(0);
  expect(data.profileSamples.at(-1)?.distanceM).toBe(data.lengthM);

  for (const [index, sample] of data.profileSamples.entries()) {
    expect(sample.distanceM).toBe(index * 10);
  }
}

function firstElevationM(data: Readonly<typeof COAST_LOOP>): number {
  const sample = data.profileSamples[0];

  if (sample === undefined) throw new TypeError("profile sample is missing");

  return sample.elevationM;
}

function lastElevationM(data: Readonly<typeof COAST_LOOP>): number {
  const sample = data.profileSamples.at(-1);

  if (sample === undefined) throw new TypeError("profile sample is missing");

  return sample.elevationM;
}

const BIOME_ROUTES: readonly RouteData[] = [COAST_LOOP, ALPINE_PASS, NIGHT_CITY];

const LOOP_ROUTES: readonly {
  readonly id: string;
  readonly data: RouteData;
  readonly expectedPoints: number;
}[] = [
  { id: COAST_LOOP.id, data: COAST_LOOP, expectedPoints: 641 },
  { id: NIGHT_CITY.id, data: NIGHT_CITY, expectedPoints: 481 },
];

it.each(BIOME_ROUTES)(
  "$id validates through createRoute with matching arc length and profile",
  (data) => {
    const route = createRoute(data);
    const chords = chordLengthsM(data);
    const totalArcM = chords.reduce((sum, length) => sum + length, 0);

    expect(Math.abs(totalArcM - data.lengthM)).toBeLessThan(1e-6);
    expect(route.lengthM).toBe(data.lengthM);
    expect(route.scenery).toBe(data.scenery);
    expect(route.worldPos(0).y).toBeCloseTo(firstElevationM(data), 8);
    assertSampleSpacing(data);
  },
);

it.each(LOOP_ROUTES)(
  "$id closes exactly, spaces chords evenly and laps without an elevation seam",
  ({ data, expectedPoints }) => {
    expect(data.loop).toBe(true);
    expect(data.centerline.at(-1)).toEqual(data.centerline[0]);
    expect(data.centerline).toHaveLength(expectedPoints);

    for (const chord of chordLengthsM(data)) {
      expect(chord).toBeGreaterThan(8);
      expect(chord).toBeLessThan(20);
    }

    expect(lastElevationM(data)).toBeCloseTo(firstElevationM(data), 12);
  },
);

it("coast-loop is a gentle seaside ring: wobble bounded, grades stay under 2 %", () => {
  expect(COAST_LOOP.lengthM).toBe(8000);
  expect(COAST_LOOP.scenery).toBe("coast");
  expect(COAST_LOOP.segments).toEqual([
    { id: "boardwalk-sprint", name: "Boardwalk Sprint", kind: "sprint", startM: 1200, endM: 2700 },
  ]);

  const route = createRoute(COAST_LOOP);

  for (let distanceM = 0; distanceM <= COAST_LOOP.lengthM; distanceM += 50) {
    const gradePct = Math.abs(route.profile.gradeAt(distanceM));

    expect(route.profile.elevationAt(distanceM)).toBeGreaterThan(0);
    expect(gradePct).toBeLessThan(2);
  }

  const chordCount = COAST_LOOP.centerline.length - 1;

  expect(chordCount).toBe(640);
});

it("alpine-pass climbs 840 m at a constant 7 % over a real serpentine", () => {
  expect(ALPINE_PASS.lengthM).toBe(25_200);
  expect(ALPINE_PASS.loop).toBe(true);
  expect(ALPINE_PASS.scenery).toBe("alpine");
  expect(ALPINE_PASS.centerline).toHaveLength(2521);
  expect(ALPINE_PASS.segments).toEqual([
    { id: "pass-kom", name: "Pass KOM", kind: "kom", startM: 2000, endM: 10_000 },
  ]);

  const route = createRoute(ALPINE_PASS);
  const switchbackRad = (45 * Math.PI) / 180;

  expect(route.profile.elevationAt(0)).toBeCloseTo(160, 10);
  expect(route.profile.elevationAt(12_000)).toBeCloseTo(1000, 10);
  expect(route.profile.gradeAt(6000)).toBeCloseTo(7, 6);

  // Leg 1 heads up-valley at +45°, leg 2 turns back at −45°: a real hairpin pair.
  expect(route.headingRad(100)).toBeCloseTo(switchbackRad, 8);
  expect(route.headingRad(1600)).toBeCloseTo(-switchbackRad, 8);

  // Each 1500 m leg advances the valley axis and swings laterally by the same amount.
  const legStart = route.worldPos(0);
  const legEnd = route.worldPos(1500);

  expect(legEnd.x).toBeCloseTo(1500 * Math.cos(switchbackRad), 8);
  expect(legEnd.z).toBeCloseTo(1500 * Math.sin(switchbackRad), 8);
  expect(legStart.x).toBe(0);

  const summit = route.worldPos(12_000);

  // 8 legs of ±1500 m cancel laterally: the climb tops out back on the valley axis.
  expect(summit.z).toBeCloseTo(0, 8);
  expect(summit.x).toBeCloseTo(8 * 1500 * Math.cos(switchbackRad), 6);
});

it("alpine-pass loops over the saddle and down a second serpentine instead of ending", () => {
  const route = createRoute(ALPINE_PASS);

  // Flat across the saddle, 7 % down the far flank, flat back across the valley floor.
  expect(route.profile.gradeAt(12_300)).toBeCloseTo(0, 6);
  expect(route.profile.gradeAt(18_000)).toBeCloseTo(-7, 6);
  expect(route.profile.elevationAt(24_600)).toBeCloseTo(160, 10);
  expect(route.profile.gradeAt(24_900)).toBeCloseTo(0, 6);

  // The lap closes exactly: past 25.2 km the ride is back at the start, at the start height.
  expect(ALPINE_PASS.centerline.at(-1)).toEqual({ x: 0, z: 0 });
  expect(route.worldPos(25_200 + 100)).toEqual(route.worldPos(100));
  expect(route.profile.elevationAt(25_200)).toBeCloseTo(160, 10);

  // The climb stays north of the valley axis, the descent at least 600 m south of it.
  for (let distanceM = 0; distanceM <= 12_000; distanceM += 50)
    expect(route.worldPos(distanceM).z).toBeGreaterThan(-1e-6);

  for (let distanceM = 12_600; distanceM <= 24_600; distanceM += 50)
    expect(route.worldPos(distanceM).z).toBeLessThan(-600 + 1e-6);
});

it("night-city is a flat dark block ring with a seamless lap", () => {
  expect(NIGHT_CITY.lengthM).toBe(6000);
  expect(NIGHT_CITY.scenery).toBe("night-city");
  expect(NIGHT_CITY.segments).toEqual([
    { id: "neon-sprint", name: "Neon Sprint", kind: "sprint", startM: 800, endM: 1800 },
  ]);

  const route = createRoute(NIGHT_CITY);

  for (let distanceM = 0; distanceM <= NIGHT_CITY.lengthM; distanceM += 100) {
    const elevationM = route.profile.elevationAt(distanceM);

    expect(elevationM).toBeGreaterThanOrEqual(11);
    expect(elevationM).toBeLessThanOrEqual(13);
    expect(Math.abs(route.profile.gradeAt(distanceM))).toBeLessThan(2);
  }

  // The superellipse ring keeps flat sides: the mid-avenue points sit near the
  // maximum extent on one axis and near zero on the other.
  const avenue = route.worldPos(1500);

  expect(Math.abs(avenue.x)).toBeLessThan(80);
  expect(Math.abs(avenue.z)).toBeGreaterThan(500);
});
