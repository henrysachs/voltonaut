import { describe, expect, it } from "vitest";

import type { ElevationSample } from "./profile.js";
import { createElevationProfile, DEFAULT_SMOOTHING_M } from "./profile.js";

const LINEAR: readonly ElevationSample[] = [
  { distanceM: 0, elevationM: 100 },
  { distanceM: 100, elevationM: 110 },
  { distanceM: 200, elevationM: 110 },
  { distanceM: 300, elevationM: 130 },
];

function linearProfile(loop = false) {
  return createElevationProfile(LINEAR, { loop });
}

describe("elevationAt", () => {
  it("returns the exact sample elevations at support points", () => {
    const profile = linearProfile();

    expect(profile.elevationAt(0)).toBe(100);
    expect(profile.elevationAt(100)).toBe(110);
    expect(profile.elevationAt(200)).toBe(110);
    expect(profile.elevationAt(300)).toBe(130);
  });

  it("interpolates linearly between support points", () => {
    const profile = linearProfile();

    expect(profile.elevationAt(50)).toBe(105);
    expect(profile.elevationAt(250)).toBe(120);
  });

  it("holds the end values outside [0, L] for non-loop profiles", () => {
    const profile = linearProfile();

    expect(profile.elevationAt(-50)).toBe(100);
    expect(profile.elevationAt(350)).toBe(130);
  });

  it("wraps positions with d mod L for loop profiles", () => {
    const profile = linearProfile(true);

    expect(profile.elevationAt(350)).toBeCloseTo(105, 10);
    expect(profile.elevationAt(300)).toBe(100);
    expect(profile.elevationAt(400)).toBe(110);
  });
});

describe("gradeAt (central difference, smoothing 25 m)", () => {
  it("defaults the smoothing window to 25 m", () => {
    expect(DEFAULT_SMOOTHING_M).toBe(25);
  });

  it("reports the exact slope on constant grades and 0 % on flats", () => {
    const profile = linearProfile();

    // 0-100 m climb 10 m: +10 %.
    expect(profile.gradeAt(50)).toBeCloseTo(10, 10);
    // 100-200 m flat: 0 %.
    expect(profile.gradeAt(150)).toBe(0);
    expect(profile.gradeAt(175)).toBe(0);
  });

  it("divides the clamped window by its actual width at non-loop ends", () => {
    const climb = createElevationProfile(
      [
        { distanceM: 0, elevationM: 100 },
        { distanceM: 2500, elevationM: 300 },
      ],
      { loop: false },
    );

    expect(climb.gradeAt(0)).toBeCloseTo(8, 10);
    expect(climb.gradeAt(1250)).toBeCloseTo(8, 10);
    expect(climb.gradeAt(2500)).toBeCloseTo(8, 10);
  });

  it("averages the 25 m window across a grade transition", () => {
    const profile = linearProfile();

    // Window [87.5, 112.5]: 12.5 m at +10 % then 12.5 m flat => +5 %.
    expect(profile.gradeAt(100)).toBeCloseTo(5, 6);
    // Window [262.5, 287.5]: entirely on the +20 % section.
    expect(profile.gradeAt(275)).toBeCloseTo(20, 6);
  });
});

describe("gradeAt wrapping and validation", () => {
  it("closes the window across the wrap on loop profiles", () => {
    // Loop data here is not elevation-closed (130 m at 300 wraps back to 100 m):
    // the central window [282.5, 307.5] spans 126.5 m at the end and 100.75 m
    // after the wrap, so the seam jump shows up as -103 %.
    const profile = linearProfile(true);

    expect(profile.gradeAt(295)).toBeCloseTo(-103, 6);
  });

  it("rejects invalid smoothing windows", () => {
    const profile = linearProfile();

    expect(() => profile.gradeAt(10, 0)).toThrow(RangeError);
    expect(() => profile.gradeAt(10, -5)).toThrow(RangeError);
  });
});

describe("createElevationProfile validation", () => {
  it("rejects zero-length profiles and non-finite distances", () => {
    expect(() =>
      createElevationProfile(
        [
          { distanceM: -10, elevationM: 100 },
          { distanceM: 0, elevationM: 100 },
        ],
        { loop: false },
      ),
    ).toThrow("positive length");
    expect(() =>
      createElevationProfile(
        [
          { distanceM: 0, elevationM: 100 },
          { distanceM: Number.POSITIVE_INFINITY, elevationM: 100 },
        ],
        { loop: false },
      ),
    ).toThrow("not finite");
  });
});

describe("createElevationProfile sample validation", () => {
  it("rejects fewer than two samples", () => {
    expect(() =>
      createElevationProfile([{ distanceM: 0, elevationM: 100 }], { loop: false }),
    ).toThrow(RangeError);
  });

  it("rejects non-increasing distances", () => {
    expect(() =>
      createElevationProfile(
        [
          { distanceM: 0, elevationM: 100 },
          { distanceM: 0, elevationM: 101 },
        ],
        { loop: false },
      ),
    ).toThrow(RangeError);
  });

  it("rejects non-finite samples", () => {
    expect(() =>
      createElevationProfile(
        [
          { distanceM: 0, elevationM: Number.NaN },
          { distanceM: 10, elevationM: 100 },
        ],
        { loop: false },
      ),
    ).toThrow(RangeError);
  });
});
