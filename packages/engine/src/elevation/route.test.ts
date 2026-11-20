import { describe, expect, it } from "vitest";

import type { RouteData } from "./route.js";
import { createRoute } from "./route.js";
import { KOM_CLIMB } from "./data/kom-climb.js";
import { FLAT_LOOP } from "./data/flat-loop.js";
import { TEST_LOOP } from "./data/test-loop.js";

function lineRoute(overrides: Partial<RouteData> = {}): RouteData {
  return {
    id: "line",
    name: "Line",
    lengthM: 100,
    loop: false,
    centerline: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
    ],
    profileSamples: [
      { distanceM: 0, elevationM: 10 },
      { distanceM: 100, elevationM: 10 },
    ],
    segments: [],
    scenery: "plain",
    ...overrides,
  };
}

describe("createRoute validation", () => {
  it("rejects invalid lengths and insufficient centerlines", () => {
    expect(() => createRoute(lineRoute({ lengthM: 0 }))).toThrow("positive and finite");
    expect(() => createRoute(lineRoute({ lengthM: Number.NaN }))).toThrow("positive and finite");
    expect(() => createRoute(lineRoute({ centerline: [] }))).toThrow(
      "at least 2 centerline points",
    );
  });

  it("accepts the three shipped test routes", () => {
    expect(() => createRoute(FLAT_LOOP)).not.toThrow();
    expect(() => createRoute(TEST_LOOP)).not.toThrow();
    expect(() => createRoute(KOM_CLIMB)).not.toThrow();
  });

  it("rejects a centerline whose arc length mismatches lengthM", () => {
    expect(() =>
      createRoute(
        lineRoute({
          centerline: [
            { x: 0, z: 0 },
            { x: 50, z: 0 },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });

  it("rejects a loop whose centerline does not close exactly", () => {
    expect(() =>
      createRoute(
        lineRoute({
          loop: true,
          centerline: [
            { x: 0, z: 0 },
            { x: 100, z: 1 },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });
});

describe("createRoute profile and segment validation", () => {
  it("rejects an elevation profile that does not span the route", () => {
    expect(() =>
      createRoute(
        lineRoute({
          profileSamples: [
            { distanceM: 0, elevationM: 10 },
            { distanceM: 50, elevationM: 12 },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });

  it("rejects segments outside the route and duplicate segment ids", () => {
    expect(() =>
      createRoute(
        lineRoute({
          segments: [{ id: "a", name: "A", kind: "sprint", startM: 80, endM: 120 }],
        }),
      ),
    ).toThrow(RangeError);

    expect(() =>
      createRoute(
        lineRoute({
          segments: [
            { id: "a", name: "A", kind: "sprint", startM: 0, endM: 10 },
            { id: "a", name: "A2", kind: "kom", startM: 20, endM: 30 },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });
});

describe("worldPos and headingRad", () => {
  it("interpolates along a straight centerline with elevation as Y", () => {
    const route = createRoute(lineRoute());

    expect(route.worldPos(0)).toEqual({ x: 0, y: 10, z: 0 });
    expect(route.worldPos(50)).toEqual({ x: 50, y: 10, z: 0 });
    expect(route.worldPos(100)).toEqual({ x: 100, y: 10, z: 0 });
    expect(route.worldPos(150)).toEqual({ x: 100, y: 10, z: 0 });
    expect(route.headingRad(25)).toBe(0);
  });

  it("wraps the position exactly at the loop seam", () => {
    const route = createRoute(
      lineRoute({
        loop: true,
        centerline: [
          { x: 0, z: 0 },
          { x: 50, z: 0 },
          { x: 0, z: 0 },
        ],
      }),
    );

    expect(route.worldPos(100)).toEqual(route.worldPos(0));
    expect(route.worldPos(100.5)).toEqual(route.worldPos(0.5));
  });
});

describe("headingRad at route seams", () => {
  it("keeps the heading continuous across the loop seam", () => {
    const flatLoop = createRoute(FLAT_LOOP);
    const beforeSeam = flatLoop.headingRad(flatLoop.lengthM - 0.01);
    const afterSeam = flatLoop.headingRad(0);
    const seamGapRad = Math.abs(beforeSeam - afterSeam);
    const wrappedGapRad = Math.min(seamGapRad, Math.PI * 2 - seamGapRad);

    // A 500-gon has a 0.72 degree exterior angle at every vertex, seam included.
    expect(wrappedGapRad).toBeLessThan(0.02);
  });

  it("uses the closing segment direction for the last point of a non-loop", () => {
    const route = createRoute(
      lineRoute({
        lengthM: 150,
        profileSamples: [
          { distanceM: 0, elevationM: 10 },
          { distanceM: 150, elevationM: 10 },
        ],
        centerline: [
          { x: 0, z: 0 },
          { x: 70.71067811865476, z: 70.71067811865476 },
          { x: 120.71067811865476, z: 70.71067811865476 },
        ],
      }),
    );

    expect(route.headingRad(75)).toBeCloseTo(Math.atan2(70.71067811865476, 70.71067811865476), 10);
    expect(route.headingRad(150)).toBe(0);
  });
});

describe("shipped route data", () => {
  it("flat-loop is flat and 5 km long", () => {
    const route = createRoute(FLAT_LOOP);

    expect(route.lengthM).toBe(5000);
    expect(route.loop).toBe(true);
    expect(route.profile.gradeAt(1234)).toBe(0);
    expect(route.segments).toEqual([]);
  });

  it("test-loop carries the sprint and KOM segments at the documented grades", () => {
    const route = createRoute(TEST_LOOP);

    expect(route.lengthM).toBe(10000);
    expect(route.segments.map((segment) => segment.id)).toEqual(["sprint-1", "kom-1"]);
    expect(route.profile.gradeAt(2250)).toBe(0);
    expect(route.profile.gradeAt(3600)).toBeCloseTo(4, 6);
    expect(route.profile.gradeAt(5300)).toBeCloseTo(8, 6);
    expect(route.profile.gradeAt(6100)).toBeCloseTo(-6, 6);
    expect(route.profile.gradeAt(9000)).toBeCloseTo(-1.8, 6);
    // Elevation closes across the wrap (100 m at 0 and at 10000).
    expect(route.profile.elevationAt(0)).toBe(route.profile.elevationAt(10000));
  });

  it("kom-climb is a constant 8 % non-loop climb of 2500 m", () => {
    const route = createRoute(KOM_CLIMB);

    expect(route.loop).toBe(false);
    expect(route.lengthM).toBe(2500);
    expect(route.profile.elevationAt(0)).toBe(100);
    expect(route.profile.elevationAt(2500)).toBe(300);
    expect(route.profile.gradeAt(500)).toBeCloseTo(8, 6);
    expect(route.profile.gradeAt(2400)).toBeCloseTo(8, 6);
  });
});
