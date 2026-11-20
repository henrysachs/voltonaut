import { describe, expect, it } from "vitest";

import { elevationGainDeltaM, energyDeltaKj, lapsCompleted, routePositionM } from "./sums.js";

describe("routePositionM", () => {
  it("wraps the odometer on loops", () => {
    expect(routePositionM(5000, 5000, true)).toBe(0);
    expect(routePositionM(5001, 5000, true)).toBeCloseTo(1, 10);
    expect(routePositionM(12000, 5000, true)).toBeCloseTo(2000, 10);
  });

  it("clamps the odometer at the end of non-loops", () => {
    expect(routePositionM(2600, 2500, false)).toBe(2500);
    expect(routePositionM(-5, 2500, false)).toBe(0);
    expect(routePositionM(1250, 2500, false)).toBe(1250);
  });
});

describe("elevationGainDeltaM", () => {
  it("counts only positive deltas", () => {
    expect(elevationGainDeltaM(100, 148)).toBe(48);
    expect(elevationGainDeltaM(148, 100)).toBe(0);
    expect(elevationGainDeltaM(100, 100)).toBe(0);
  });
});

describe("energyDeltaKj", () => {
  it("integrates raw measured power over the tick", () => {
    expect(energyDeltaKj(200, 0.05)).toBeCloseTo(0.01, 12);
    expect(energyDeltaKj(0, 0.05)).toBe(0);
  });

  it("accumulates to 720 kJ for 60 min at 200 W", () => {
    let energyKj = 0;

    for (let tick = 0; tick < 72_000; tick += 1) {
      energyKj += energyDeltaKj(200, 0.05);
    }

    expect(energyKj).toBeCloseTo(720, 6);
  });
});

describe("lapsCompleted", () => {
  it("counts full loops only", () => {
    expect(lapsCompleted(4999.9, 5000, true)).toBe(0);
    expect(lapsCompleted(5000, 5000, true)).toBe(1);
    expect(lapsCompleted(12345, 5000, true)).toBe(2);
    expect(lapsCompleted(12345, 5000, false)).toBe(0);
  });
});
