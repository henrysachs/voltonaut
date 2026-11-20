import type { SimClock } from "../sim/clock.js";

/** Real-time clock backed by performance.now(); the replay pump converts tMs to seconds. */
export function createPerformanceClock(): SimClock {
  return {
    nowS: () => performance.now() / 1000,
  };
}
