import { expect, it } from "vitest";

import { FLAT_LOOP } from "./flat-loop.js";
import { KOM_CLIMB } from "./kom-climb.js";
import { TEST_LOOP } from "./test-loop.js";

function testLoopElevationM(distanceM: number): number {
  if (distanceM <= 3000) return 100;

  if (distanceM <= 4200) return 100 + (distanceM - 3000) * 0.04;

  if (distanceM <= 5000) return 148;

  if (distanceM <= 5600) return 148 + (distanceM - 5000) * 0.08;

  if (distanceM <= 6600) return 196 - (distanceM - 5600) * 0.06;

  if (distanceM <= 8000) return 136;

  return 136 - (distanceM - 8000) * 0.018;
}

it.each([FLAT_LOOP, TEST_LOOP])(
  "$id follows a closed circular centerline with 10 m chords",
  (data) => {
    const count = data.lengthM / 10;
    const radiusM = 10 / (2 * Math.sin(Math.PI / count));

    expect(data.centerline).toHaveLength(count + 1);

    for (const [index, point] of data.centerline.entries()) {
      const angleRad = (index * 2 * Math.PI) / count;

      expect(point.x).toBeCloseTo(radiusM * Math.cos(angleRad), 8);
      expect(point.z).toBeCloseTo(radiusM * Math.sin(angleRad), 8);
    }

    expect(data.centerline.at(-1)).toEqual(data.centerline.at(0));
  },
);

it("test-loop samples follow every documented climb and descent at 10 m intervals", () => {
  expect(TEST_LOOP.profileSamples).toHaveLength(1001);

  for (const [index, sample] of TEST_LOOP.profileSamples.entries()) {
    expect(sample.distanceM).toBe(index * 10);
    expect(sample.elevationM).toBeCloseTo(testLoopElevationM(index * 10), 8);
  }
});

it("kom-climb samples form a constant 8 % climb at 10 m intervals", () => {
  expect(KOM_CLIMB.centerline).toEqual([
    { x: 0, z: 0 },
    { x: 2500, z: 0 },
  ]);
  expect(KOM_CLIMB.profileSamples).toHaveLength(251);

  for (const [index, sample] of KOM_CLIMB.profileSamples.entries()) {
    expect(sample.distanceM).toBe(index * 10);
    expect(sample.elevationM).toBeCloseTo(100 + index * 0.8, 8);
  }
});

it("flat-loop holds 100 m elevation at both ends", () => {
  expect(FLAT_LOOP.profileSamples).toEqual([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 5000, elevationM: 100 },
  ]);
});
