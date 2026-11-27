import { expect, it } from "vitest";

import { assertSmoothCenterline } from "../../world/curvature.js";
import { createRoute } from "../route.js";

import { VINEYARD_INTERVALS } from "./vineyard-intervals.js";

interface Ramp {
  readonly startM: number;
  readonly endM: number;
  readonly gradePct: number;
}

const RAMP_MIN_GRADE_PCT = 3;

/** Ramps read from the 10 m profile samples: maximal runs that climb at 3 % or more. */
function rampsOf(): readonly Ramp[] {
  const samples = VINEYARD_INTERVALS.profileSamples;
  const ramps: Ramp[] = [];
  let startIndex = -1;

  for (const [index, sample] of samples.entries()) {
    const next = samples[index + 1];

    const gradePct =
      next === undefined
        ? 0
        : ((next.elevationM - sample.elevationM) / (next.distanceM - sample.distanceM)) * 100;

    if (gradePct >= RAMP_MIN_GRADE_PCT - 1e-9) {
      if (startIndex < 0) startIndex = index;
    } else if (startIndex >= 0) {
      const start = samples[startIndex];

      ramps.push({
        startM: start?.distanceM ?? 0,
        endM: sample.distanceM,
        gradePct:
          ((sample.elevationM - (start?.elevationM ?? 0)) /
            (sample.distanceM - (start?.distanceM ?? 0))) *
          100,
      });
      startIndex = -1;
    }
  }

  return ramps;
}

it("is a 12–15 km loop in the vineyard scenery named Weinberg-Intervalle", () => {
  expect(VINEYARD_INTERVALS).toMatchObject({
    id: "vineyard-intervals",
    name: "Weinberg-Intervalle",
    loop: true,
    scenery: "vineyard",
  });
  expect(VINEYARD_INTERVALS.lengthM).toBeGreaterThanOrEqual(12_000);
  expect(VINEYARD_INTERVALS.lengthM).toBeLessThanOrEqual(15_000);
  expect(() => createRoute(VINEYARD_INTERVALS)).not.toThrow();
});

it("has 6–10 ramps of 300–800 m at 3–7 %", () => {
  const ramps = rampsOf();

  expect(ramps.length).toBeGreaterThanOrEqual(6);
  expect(ramps.length).toBeLessThanOrEqual(10);

  for (const ramp of ramps) {
    expect(ramp.endM - ramp.startM).toBeGreaterThanOrEqual(300);
    expect(ramp.endM - ramp.startM).toBeLessThanOrEqual(800);
    expect(ramp.gradePct).toBeGreaterThanOrEqual(3);
    expect(ramp.gradePct).toBeLessThanOrEqual(7);
  }
});

/** Length of the vertical curves that round crests and valleys. */
const CURVE_M = 60;

/** Whether the profile only falls between a ramp's rounded crest and the next ramp's valley. */
function descendsAfter(ramp: Ramp, nextStartM: number): boolean {
  const between = VINEYARD_INTERVALS.profileSamples.filter(
    (sample) => sample.distanceM >= ramp.endM + CURVE_M && sample.distanceM <= nextStartM - CURVE_M,
  );

  return between.every(
    (sample, index) => index === 0 || sample.elevationM < required(between[index - 1]).elevationM,
  );
}

/** Start of the ramp after this one; the last ramp's descent runs to the lap line. */
function nextRampStartM(ramps: readonly Ramp[], index: number): number {
  return ramps[index + 1]?.startM ?? VINEYARD_INTERVALS.lengthM;
}

function rampsAt(distanceM: number): readonly Ramp[] {
  return rampsOf().filter((ramp) => ramp.startM <= distanceM && distanceM <= ramp.endM);
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new RangeError("test data is missing");

  return value;
}

it("separates the ramps by descents of at least 300 m and never climbs between them", () => {
  const ramps = rampsOf();

  for (const [index, ramp] of ramps.entries()) {
    const nextStartM = nextRampStartM(ramps, index);

    expect(descendsAfter(ramp, nextStartM)).toBe(true);
    expect(nextStartM - ramp.endM).toBeGreaterThanOrEqual(300);
  }
});

it("rides the ramps at their grade on the sim's smoothed profile", () => {
  const route = createRoute(VINEYARD_INTERVALS);

  for (const ramp of rampsOf()) {
    const gradePct = route.profile.gradeAt((ramp.startM + ramp.endM) / 2);

    expect(gradePct).toBeGreaterThanOrEqual(3);
    expect(gradePct).toBeLessThanOrEqual(7);
    expect(Math.abs(gradePct - ramp.gradePct)).toBeLessThan(0.6);
  }
});

it("closes seamlessly: the lap ends at the height and heading it starts with", () => {
  const samples = VINEYARD_INTERVALS.profileSamples;
  const route = createRoute(VINEYARD_INTERVALS);

  expect(required(samples.at(-1)).elevationM).toBeCloseTo(required(samples[0]).elevationM, 12);
  expect(VINEYARD_INTERVALS.centerline.at(-1)).toEqual(VINEYARD_INTERVALS.centerline[0]);
  expect(() => {
    assertSmoothCenterline(VINEYARD_INTERVALS.centerline, true, "vineyard");
  }).not.toThrow();
  expect(route.headingRad(VINEYARD_INTERVALS.lengthM - 1)).toBeCloseTo(route.headingRad(1), 1);
});

it("marks one KOM segment on exactly one ramp", () => {
  const [segment, ...others] = VINEYARD_INTERVALS.segments;
  const kom = required(segment);
  const middleM = (kom.startM + kom.endM) / 2;
  const ramps = rampsAt(middleM);

  expect(others).toEqual([]);
  expect(kom).toMatchObject({ id: "rebhang-kom", name: "Rebhang KOM", kind: "kom" });
  expect(ramps).toHaveLength(1);
  expect(
    Math.abs(kom.endM - kom.startM - (required(ramps[0]).endM - required(ramps[0]).startM)),
  ).toBeLessThan(60);
});
