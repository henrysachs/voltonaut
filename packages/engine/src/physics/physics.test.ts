import { describe, expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import type { RiderParams } from "./params.js";
import { DEFAULT_RIDER_PARAMS, estimateCdaM2, riderParamsFromProfile } from "./params.js";
import { forces, netForceN } from "./forces.js";
import { advanceSpeedMps, stationarySpeedMps } from "./integrate.js";

const KM_H = 3.6;

function speedKmh(
  gradePct: number,
  powerW: number,
  params: RiderParams = DEFAULT_RIDER_PARAMS,
): number {
  return stationarySpeedMps(gradePct, powerW, params) * KM_H;
}

describe("stationary anchors (83 kg total, pinned constants)", () => {
  it("200 W at 0 % settles at 33.0-34.0 km/h", () => {
    expect(speedKmh(0, 200)).toBeGreaterThanOrEqual(33);
    expect(speedKmh(0, 200)).toBeLessThanOrEqual(34);
  });

  it("250 W at 8 % settles at 11.5-13.0 km/h", () => {
    expect(speedKmh(8, 250)).toBeGreaterThanOrEqual(11.5);
    expect(speedKmh(8, 250)).toBeLessThanOrEqual(13);
  });

  it("coasting at -6 % settles at the 54-56 km/h terminal speed", () => {
    expect(speedKmh(-6, 0)).toBeGreaterThanOrEqual(54);
    expect(speedKmh(-6, 0)).toBeLessThanOrEqual(56);
  });

  it("leaves the stationary speed in equilibrium (net force ~ 0)", () => {
    const speedMps = stationarySpeedMps(0, 200);

    expect(Math.abs(netForceN(speedMps, 0, 200, DEFAULT_RIDER_PARAMS, 0))).toBeLessThan(0.01);
  });
});

describe("force model", () => {
  it("computes the four forces from the docs/03 section 2 formulas", () => {
    const f = forces(10, 0, 200, DEFAULT_RIDER_PARAMS, 0);

    // F_p = 0.97 * 200 / 10 = 19.4 N; F_r = 83 * 9.81 * 0.004 ~ 3.26 N;
    // F_a = 0.5 * 1.225 * 0.32 * 100 ~ 19.6 N; F_g = 0.
    expect(f.propulsiveN).toBeCloseTo(19.4, 6);
    expect(f.gravityN).toBe(0);
    expect(f.rollingN).toBeCloseTo(83 * 9.81 * 0.004, 6);
    expect(f.aeroN).toBeCloseTo(0.5 * 1.225 * 0.32 * 100, 6);
    expect(netForceN(10, 0, 200, DEFAULT_RIDER_PARAMS, 0)).toBeCloseTo(
      19.4 - 83 * 9.81 * 0.004 - 19.6,
      6,
    );
  });

  it("uses the 0.5 m/s floor for propulsive force at standstill", () => {
    const f = forces(0, 0, 200, DEFAULT_RIDER_PARAMS, 0);

    expect(f.propulsiveN).toBeCloseTo((0.97 * 200) / 0.5, 6);
  });

  it("includes the wind term with its sign", () => {
    // Apparent wind v + w flips sign between the two cases.
    const headwind = forces(1, 0, 0, DEFAULT_RIDER_PARAMS, -2);
    const tailwind = forces(1, 0, 0, DEFAULT_RIDER_PARAMS, 2);

    expect(headwind.aeroN).toBeLessThan(0);
    expect(tailwind.aeroN).toBeGreaterThan(0);
  });
});

describe("integration", () => {
  it("never rolls backwards: speed stays at 0 without power on a climb", () => {
    let speed = 0;

    for (let tick = 0; tick < 200; tick += 1) {
      speed = advanceSpeedMps(speed, 8, 0, DEFAULT_RIDER_PARAMS, 0, 0.05);
    }

    expect(speed).toBe(0);
  });

  it("accelerates downhill without power toward the terminal speed", () => {
    let speed = 0;

    for (let tick = 0; tick < 100; tick += 1) {
      const next = advanceSpeedMps(speed, -6, 0, DEFAULT_RIDER_PARAMS, 0, 0.05);
      expect(next).toBeGreaterThan(speed);
      speed = next;
    }

    // After 5 s of -6 % coasting: v = 15.25 * tanh(0.0355 * 5) ~ 2.68 m/s.
    expect(speed).toBeGreaterThan(2.5);
    expect(speed).toBeLessThan(3);

    for (let tick = 0; tick < 3900; tick += 1) {
      speed = advanceSpeedMps(speed, -6, 0, DEFAULT_RIDER_PARAMS, 0, 0.05);
    }

    expect(speed).toBeGreaterThan(14);
  });
});

describe("rider params derivation", () => {
  it("reproduces the 0.32 m^2 CdA default for the default profile exactly", () => {
    expect(estimateCdaM2(185, 75)).toBe(0.32);
  });

  it("scales CdA with the DuBois body surface area", () => {
    expect(estimateCdaM2(160, 50)).toBeLessThan(0.32);
    expect(estimateCdaM2(200, 100)).toBeGreaterThan(0.32);
  });

  it("derives frozen ride params from the default profile", () => {
    expect(riderParamsFromProfile(DEFAULT_RIDER_PROFILE)).toEqual({
      massKg: 75,
      bikeMassKg: 8,
      cdaM2: 0.32,
      crr: 0.004,
      wheelCircM: 2.105,
    });
  });
});
