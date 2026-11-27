import type { BleFixture } from "../fixtureSchema.js";
import { createReplayTransport, type ReplayTransport } from "../replay/ReplayTransport.js";
import { createManualTicker } from "../sim/tick.js";

export interface CaptureReplay {
  readonly transport: ReplayTransport;
  readonly ticker: ReturnType<typeof createManualTicker>;
  /** Replay clock in capture seconds. */
  readonly nowS: () => number;
  /** Delivers every entry up to `tMs`, one tick and microtask turn per entry. */
  readonly until: (tMs: number) => Promise<void>;
}

/** Replays a capture entry by entry on a manual clock that starts at `startMs`. */
export function replayCapture(capture: BleFixture, startMs = 0): CaptureReplay {
  let nowMs = startMs;
  const ticker = createManualTicker();

  const transport = createReplayTransport({
    fixture: capture,
    clock: { nowS: () => nowMs / 1000 },
    ticker,
  });

  const step = async (entries: readonly number[]): Promise<void> => {
    const [next, ...rest] = entries;

    if (next === undefined) return;

    nowMs = next;
    ticker.tick();
    await Promise.resolve();
    await step(rest);
  };

  return {
    transport,
    ticker,
    nowS: () => nowMs / 1000,
    until: async (tMs) => {
      const start = nowMs;

      await step(
        capture.log
          .map((entry) => entry.tMs)
          .filter((entryMs) => entryMs > start && entryMs <= tMs),
      );
      nowMs = Math.max(nowMs, tMs);
    },
  };
}
