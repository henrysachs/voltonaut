import { describe, expect, it } from "vitest";

import { createManualClock } from "./clock.js";

describe("sim clocks", () => {
  it("advances a manual clock", () => {
    const clock = createManualClock(10);
    clock.advanceS(0.5);

    expect(clock.nowS()).toBe(10.5);
  });
});
