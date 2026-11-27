import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREVIEW_ORBIT,
  MAX_PREVIEW_PITCH_RAD,
  MIN_PREVIEW_PITCH_RAD,
  normalizePreviewOrbit,
  normalizeYawRad,
  orbitBy,
} from "./previewOrbit.js";

describe("preview orbit", () => {
  it("clamps pitch and normalizes yaw around a full turn", () => {
    expect(normalizeYawRad(0)).toBe(0);
    expect(normalizeYawRad(Math.PI)).toBeCloseTo(-Math.PI);
    expect(normalizeYawRad(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(normalizeYawRad(-3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(normalizePreviewOrbit({ yawRad: 5 * Math.PI, pitchRad: 10 })).toEqual({
      yawRad: normalizeYawRad(5 * Math.PI),
      pitchRad: MAX_PREVIEW_PITCH_RAD,
    });
    expect(normalizePreviewOrbit({ yawRad: -5 * Math.PI, pitchRad: -10 }).pitchRad).toBe(
      MIN_PREVIEW_PITCH_RAD,
    );
  });

  it("applies relative input without mutating the current orbit", () => {
    const current = Object.freeze({ yawRad: Math.PI - 0.1, pitchRad: 0.2 });
    const next = orbitBy(current, { yawRad: 0.2, pitchRad: 0.1 });

    expect(current).toEqual({ yawRad: Math.PI - 0.1, pitchRad: 0.2 });
    expect(next.yawRad).toBeCloseTo(-Math.PI + 0.1);
    expect(next.pitchRad).toBeCloseTo(0.3);
  });

  it("keeps the current orbit for non-finite input", () => {
    const current = Object.freeze({ ...DEFAULT_PREVIEW_ORBIT });

    expect(orbitBy(current, { yawRad: Number.NaN, pitchRad: 0.1 })).toBe(current);
    expect(orbitBy(current, { yawRad: 0.1, pitchRad: Number.POSITIVE_INFINITY })).toBe(current);
  });
});
