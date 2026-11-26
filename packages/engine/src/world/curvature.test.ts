import { expect, it } from "vitest";

import { FLAT_LOOP } from "../elevation/data/flat-loop.js";
import { KOM_CLIMB } from "../elevation/data/kom-climb.js";
import { TEST_LOOP } from "../elevation/data/test-loop.js";
import type { CenterlinePoint } from "../elevation/route.js";

import { assertSmoothCenterline, MAX_VERTEX_TURN_RAD, MIN_CURVE_RADIUS_M } from "./curvature.js";

const DIAGONAL = Math.SQRT1_2;
const DROP_RADIUS_M = 20;
const DROP_CENTER_X = DROP_RADIUS_M / DIAGONAL;
const ARC_STEPS = 60;

function check(points: readonly CenterlinePoint[], closed: boolean, label: string): () => void {
  return () => {
    assertSmoothCenterline(points, closed, label);
  };
}

/** Two points around a vertex at the origin: chords of the given length, turning by angleRad. */
function bend(chordM: number, angleRad: number): readonly CenterlinePoint[] {
  return [
    { x: -chordM, z: 0 },
    { x: 0, z: 0 },
    { x: chordM * Math.cos(angleRad), z: chordM * Math.sin(angleRad) },
  ];
}

/**
 * Teardrop: leaves the origin at -45°, rounds a tangent arc and returns along +45°.
 * Every vertex is smooth except the seam, where the road turns by 90°.
 */
function teardrop(): readonly CenterlinePoint[] {
  const out = Array.from({ length: 11 }, (_, step) => ({
    x: 2 * step * DIAGONAL,
    z: 0 - 2 * step * DIAGONAL,
  }));

  const arc = Array.from({ length: ARC_STEPS - 1 }, (_, step) => {
    const angleRad = (-3 * Math.PI) / 4 + ((step + 1) * (3 * Math.PI)) / (2 * ARC_STEPS);

    return {
      x: DROP_CENTER_X + DROP_RADIUS_M * Math.cos(angleRad),
      z: DROP_RADIUS_M * Math.sin(angleRad),
    };
  });

  const back = Array.from({ length: 11 }, (_, step) => ({
    x: (20 - 2 * step) * DIAGONAL,
    z: (20 - 2 * step) * DIAGONAL,
  }));

  return [...out, ...arc, ...back];
}

it("proposes a 0.2 rad vertex limit and a 10 m minimum radius", () => {
  expect(MAX_VERTEX_TURN_RAD).toBe(0.2);
  expect(MIN_CURVE_RADIUS_M).toBe(10);
});

it("accepts every shipped centerline", () => {
  expect(check(FLAT_LOOP.centerline, true, "flat")).not.toThrow();
  expect(check(TEST_LOOP.centerline, true, "test")).not.toThrow();
  expect(check(KOM_CLIMB.centerline, false, "kom")).not.toThrow();
});

it("limits long chords by the vertex angle", () => {
  expect(check(bend(50, 0.19), false, "road")).not.toThrow();
  expect(check(bend(50, -0.19), false, "road")).not.toThrow();
  expect(check(bend(50, 0.21), false, "road")).toThrow(
    /^road kinks by 0\.21\d* rad at point 1 \(limit 0\.2 rad\)$/u,
  );
  expect(check(bend(50, -0.21), false, "road")).toThrow("road kinks");
});

it("limits short chords by the minimum radius", () => {
  expect(check(bend(1, 0.09), false, "hairpin")).not.toThrow();
  expect(check(bend(1, 0.11), false, "hairpin")).toThrow(
    /^hairpin kinks by 0\.11\d* rad at point 1 \(limit 0\.1 rad\)$/u,
  );
});

it("uses the shorter adjacent chord for the radius limit", () => {
  const uneven = [
    { x: -50, z: 0 },
    { x: 0, z: 0 },
    { x: Math.cos(0.15), z: Math.sin(0.15) },
  ];

  expect(check(uneven, false, "uneven")).toThrow("uneven kinks");
  expect(check(uneven.toReversed(), false, "uneven")).toThrow("uneven kinks");
});

it("treats a reversal as the largest possible kink", () => {
  const reversal = [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 0, z: 0 },
  ];

  expect(check(reversal, false, "back")).toThrow(`back kinks by ${Math.PI} rad at point 1`);
});

it("accepts centerlines without a vertex", () => {
  expect(check([], true, "empty")).not.toThrow();
  expect(check([{ x: 0, z: 0 }], true, "dot")).not.toThrow();
  expect(
    check(
      [
        { x: 0, z: 0 },
        { x: 5, z: 0 },
      ],
      false,
      "line",
    ),
  ).not.toThrow();
});

it("rejects zero-length chords", () => {
  const repeated = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 0 },
  ];

  expect(check(repeated, false, "dup")).toThrow("dup has a zero-length chord at point 2");
});

it("checks the seam of a closed centerline only", () => {
  const drop = teardrop();

  expect(drop.at(-1)).toStrictEqual(drop[0]);
  expect(check(drop, false, "drop")).not.toThrow();
  expect(check(drop, true, "drop")).toThrow(/^drop kinks by 1\.57\d* rad at point 0/u);
});
