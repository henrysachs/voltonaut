import { describe, expect, it } from "vitest";

import { createManualClock, createScaledClock } from "./clock.js";

describe("sim clocks", () => {
  it("advances a manual clock", () => {
    const clock = createManualClock(10);
    clock.advanceS(0.5);

    expect(clock.nowS()).toBe(10.5);
  });

  it("scales an injected clock without hiding the source", () => {
    const manualClock = createManualClock(2);
    const clock = createScaledClock(manualClock, 10);
    manualClock.advanceS(3);

    expect(clock.nowS()).toBe(50);
  });
});
