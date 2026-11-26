import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import type { EnvironmentScript } from "./environment.js";
import { createFrameSampler, interpolateRide } from "./frame.js";

const snapshot = createEngine({
  route: createRoute(TEST_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

describe("render-only snapshot interpolation", () => {
  it("interpolates positions and cumulative distance without mutating engine snapshots", () => {
    const next = Object.freeze({
      ...snapshot,
      tS: 1,
      distanceM: 10,
      worldPos: Object.freeze({ x: 10, y: 20, z: 30 }),
    });

    const frame = interpolateRide(snapshot, next, 0.5);

    expect(frame.distanceM).toBe(5);
    expect(frame.worldPos.x).toBe((snapshot.worldPos.x + 10) / 2);
    expect(frame.worldPos.y).toBe((snapshot.worldPos.y + 20) / 2);
    expect(frame.tS).toBe(0.5);
    expect(snapshot.distanceM).toBe(0);
    expect(next.worldPos).toEqual({ x: 10, y: 20, z: 30 });
    expect(interpolateRide(snapshot, next, -1).distanceM).toBe(0);
    expect(interpolateRide(snapshot, next, 2).distanceM).toBe(10);
  });

  it("takes the short heading path across the angle seam", () => {
    const previous = { ...snapshot, headingRad: Math.PI - 0.1 };
    const current = { ...snapshot, headingRad: -Math.PI + 0.1 };

    expect(interpolateRide(previous, current, 0.5).headingRad).toBeCloseTo(Math.PI);
  });
});

describe("render frame environment and timing", () => {
  it("adds a deterministic environment snapshot derived from ride time", () => {
    const script: EnvironmentScript = [
      { startS: 0, weather: "clear" },
      { startS: 30, weather: "rain" },
    ];

    const sampler = createFrameSampler({ seed: 7, startTimeS: 0, script });
    const next = { ...snapshot, tS: 60 };

    expect(sampler.sample(snapshot, 100).env.weather).toBe("clear");
    expect(sampler.sample(next, 150).env.weather).toBe("clear");
    const frame = sampler.sample(next, 200);

    expect(frame.env).toMatchObject({ seed: 7, timeOfDayS: 60, weather: "rain" });
    expect(sampler.sample(next, 200).env).toEqual(frame.env);
  });

  it("uses arrival spacing, stops at the latest snapshot and bounds background frame gaps", () => {
    const sampler = createFrameSampler();
    const next = { ...snapshot, tS: 1, distanceM: 20 };

    expect(sampler.sample(snapshot, 100).dtS).toBe(0);
    expect(sampler.sample(next, 150).ride.distanceM).toBe(0);
    expect(sampler.sample(next, 175).ride.distanceM).toBe(10);
    expect(sampler.sample(next, 200).ride.distanceM).toBe(20);
    expect(sampler.sample(next, 5000).dtS).toBe(0.1);
    expect(sampler.sample(next, 6000).ride.distanceM).toBe(20);
  });

  it("draws the newest snapshot after a long frame gap instead of the last drawn one", () => {
    const sampler = createFrameSampler();
    const later = { ...snapshot, tS: 3, distanceM: 15 };
    const latest = { ...snapshot, tS: 6, distanceM: 30 };

    expect(sampler.sample(snapshot, 100).ride.distanceM).toBe(0);
    expect(sampler.sample(later, 3100).ride.distanceM).toBe(15);
    expect(sampler.sample(latest, 3350).ride.distanceM).toBe(15);
    expect(sampler.sample(latest, 3475).ride.distanceM).toBe(22.5);
    expect(sampler.sample(latest, 3600).ride.distanceM).toBe(30);
  });
});
