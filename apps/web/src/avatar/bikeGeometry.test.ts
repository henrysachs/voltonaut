import { describe, expect, it } from "vitest";

import { bikeGeometry, pedalPoint, type BikeGeometry } from "./bikeGeometry.js";
import { DEFAULT_WHEEL_SPEC, FRAME_SPECS, WHEEL_SPECS } from "./bikeSpecs.js";

const WHEEL_CIRC_M = 2.105;

const GEOMETRIES: readonly BikeGeometry[] = FRAME_SPECS.flatMap((frame) =>
  WHEEL_SPECS.map((wheel) => bikeGeometry(WHEEL_CIRC_M, frame, wheel)),
);

function forkOffsetM(geometry: Readonly<BikeGeometry>): number {
  const top = geometry.headTubeTop;
  const axis = geometry.steeringAxis;
  const t = (top[1] - geometry.frontAxle[1]) / axis[1];
  const onAxisX = top[0] - axis[0] * t;

  return (
    (geometry.frontAxle[0] - onAxisX) *
    Math.sin((geometry.frame.chart.headAngleDeg * Math.PI) / 180)
  );
}

describe("bike geometry from a geometry chart", () => {
  it.each(GEOMETRIES)("stands on both tires with a centred, realistic wheelbase", (geometry) => {
    const radiusM = WHEEL_CIRC_M / (2 * Math.PI);
    const wheelbaseM = geometry.frontAxle[0] - geometry.rearAxle[0];

    expect(geometry.rearAxle[1]).toBeCloseTo(radiusM, 9);
    expect(geometry.frontAxle[1]).toBeCloseTo(radiusM, 9);
    expect(geometry.rearAxle[0] + geometry.frontAxle[0]).toBeCloseTo(0, 9);
    expect(wheelbaseM).toBeGreaterThan(0.96);
    expect(wheelbaseM).toBeLessThan(1.05);
    expect(forkOffsetM(geometry)).toBeCloseTo(geometry.frame.chart.forkOffsetM, 9);
  });

  it.each(FRAME_SPECS)("reproduces stack, reach, BB drop and chainstay of $key", (frame) => {
    const geometry = bikeGeometry(WHEEL_CIRC_M, frame, DEFAULT_WHEEL_SPEC);
    const bb = geometry.bottomBracket;
    const { chart } = frame;
    const chainstayM = Math.hypot(geometry.rearAxle[0] - bb[0], geometry.rearAxle[1] - bb[1]);

    expect(geometry.headTubeTop[1] - bb[1]).toBeCloseTo(chart.stackM, 9);
    expect(geometry.headTubeTop[0] - bb[0]).toBeCloseTo(chart.reachM, 9);
    expect(geometry.rearAxle[1] - bb[1]).toBeCloseTo(chart.bbDropM, 9);
    expect(chainstayM).toBeCloseTo(chart.chainstayM, 9);
  });

  it.each(GEOMETRIES)("leaves pedal ground clearance and opposes both pedals", (geometry) => {
    for (let step = 0; step < 36; step += 1) {
      const crankRad = (step / 36) * Math.PI * 2;
      const right = pedalPoint(geometry, crankRad, 1);
      const left = pedalPoint(geometry, crankRad, -1);

      expect(Math.min(right[1], left[1])).toBeGreaterThan(0.07);
      expect(right[0] + left[0]).toBeCloseTo(geometry.bottomBracket[0] * 2, 9);
      expect(right[1] + left[1]).toBeCloseTo(geometry.bottomBracket[1] * 2, 9);
      expect(right[2]).toBe(-left[2]);
    }
  });

  it.each(GEOMETRIES)("puts saddle behind the BB, hoods ahead of the head tube", (geometry) => {
    expect(geometry.saddleTop[0]).toBeLessThan(geometry.bottomBracket[0]);
    expect(geometry.saddleTop[1] - geometry.bottomBracket[1]).toBeGreaterThan(0.65);
    expect(geometry.hoodGrip[0]).toBeGreaterThan(geometry.headTubeTop[0]);
    expect(geometry.rimRadiusM).toBeLessThan(geometry.wheelRadiusM - geometry.tireWidthM * 0.8);
  });
});
