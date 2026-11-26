import { createRoute, KOM_CLIMB, TEST_LOOP } from "@voltonaut/engine";
import { expect, it } from "vitest";

import {
  ROAD_SAMPLE_SPACING_M,
  roadCenterSamples,
  roadSampleDistances,
  sampleRoad,
} from "./road-plan.js";

const route = createRoute(TEST_LOOP);

it("samples the public engine centerline, preserves width and closes the road", () => {
  const samples = sampleRoad(route, 7);

  for (const [index, sample] of samples.entries()) {
    const position = route.worldPos((index / (samples.length - 1)) * route.lengthM);

    expect((sample.left.x + sample.right.x) / 2).toBeCloseTo(position.x);
    expect((sample.left.z + sample.right.z) / 2).toBeCloseTo(position.z);
    expect(sample.left.y).toBeCloseTo(position.y + 0.025);
    expect(Math.hypot(sample.left.x - sample.right.x, sample.left.z - sample.right.z)).toBeCloseTo(
      7,
    );
  }

  expect(samples[0]).toEqual(samples.at(-1));
});

it("spaces the support points at most 4 m apart from start to end", () => {
  const climb = createRoute(KOM_CLIMB);
  const distances = roadSampleDistances(climb);
  const gaps = distances.slice(1).map((distanceM, index) => distanceM - Number(distances[index]));

  expect(distances[0]).toBe(0);
  expect(distances.at(-1)).toBe(climb.lengthM);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(ROAD_SAMPLE_SPACING_M + 1e-9);
  expect(roadCenterSamples(climb)).toEqual(distances.map((distanceM) => climb.worldPos(distanceM)));
});
