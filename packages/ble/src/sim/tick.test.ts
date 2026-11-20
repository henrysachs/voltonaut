import { afterEach, describe, expect, it, vi } from "vitest";

import { createIntervalTicker, createManualTicker } from "./tick.js";

describe("createManualTicker", () => {
  it("calls every started listener until it stops", () => {
    const ticker = createManualTicker();
    const ticks: number[] = [];

    const stop = ticker.start(() => {
      ticks.push(1);
    });

    const stopOther = ticker.start(() => {
      ticks.push(2);
    });

    ticker.tick();
    stop();
    ticker.tick();

    expect(ticks).toEqual([1, 2, 2]);
    stopOther();
  });
});

describe("createIntervalTicker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks on the interval and stops cleanly", () => {
    vi.useFakeTimers();

    const ticker = createIntervalTicker(250);
    let ticks = 0;

    const stop = ticker.start(() => {
      ticks += 1;
    });

    vi.advanceTimersByTime(750);
    stop();
    vi.advanceTimersByTime(500);

    expect(ticks).toBe(3);
  });
});
