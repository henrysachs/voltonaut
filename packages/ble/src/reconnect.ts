import type { SimClock } from "./sim/clock.js";
import type { TickSource } from "./sim/tick.js";
import { createCell, type Cell } from "./cell.js";

/** Attempt deadlines in seconds after the disconnect (attempts at t=1/2/5/10/15). */
export const RECONNECT_ATTEMPT_DEADLINES_S: readonly number[] = [1, 2, 5, 10, 15];

export interface ReconnectControllerOptions {
  readonly clock: SimClock;
  readonly ticker: TickSource;
  /** Performs one reconnect; resolves true when the session is ready again. */
  readonly attempt: () => Promise<boolean>;
  /** Called at each attempt start; the adapter publishes "reconnecting". */
  readonly onAttempt: () => void;
  /** Called when all attempts failed; the adapter publishes "error". */
  readonly onExhausted: () => void;
}

export interface ReconnectController {
  /** Called on an unexpected disconnect; a no-op while already scheduled or terminal. */
  readonly disconnected: () => void;
  /** Resets schedule and terminal state; call from a manual user-initiated connect. */
  readonly reset: () => void;
}

type ReconnectPhase = "idle" | "scheduled" | "terminal";

interface ReconnectCounters {
  readonly attemptIndex: number;
  readonly disconnectedAtS: number;
  readonly attemptInFlight: boolean;
}

interface ReconnectState {
  readonly generation: Cell<number>;
  readonly deadlines: readonly number[];
  readonly clock: SimClock;
  readonly phase: Cell<ReconnectPhase>;
  readonly counters: Cell<ReconnectCounters>;
}

function finishAttempt(state: ReconnectState, succeeded: boolean): void {
  const counters = state.counters.get();
  state.counters.set({ ...counters, attemptInFlight: false });

  if (succeeded) {
    state.phase.set("idle");
    state.counters.set({ ...counters, attemptInFlight: false, attemptIndex: 0 });

    return;
  }

  state.counters.set({
    ...counters,
    attemptInFlight: false,
    attemptIndex: counters.attemptIndex + 1,
  });
}

function isExhausted(state: ReconnectState): boolean {
  return state.counters.get().attemptIndex >= state.deadlines.length;
}

async function runAttempt(
  options: ReconnectControllerOptions,
  state: ReconnectState,
): Promise<void> {
  const generation = state.generation.get();
  options.onAttempt();

  let succeeded = false;

  try {
    succeeded = await options.attempt();
  } catch {
    succeeded = false;
  }

  if (state.generation.get() !== generation) {
    return;
  }

  finishAttempt(state, succeeded);

  if (!isExhausted(state)) {
    return;
  }

  state.phase.set("terminal");
  options.onExhausted();
}

function dueAttempt(options: ReconnectControllerOptions, state: ReconnectState): void {
  if (state.phase.get() !== "scheduled" || state.counters.get().attemptInFlight) {
    return;
  }

  const counters = state.counters.get();
  const deadlineOffsetS = state.deadlines[counters.attemptIndex];

  if (
    deadlineOffsetS === undefined ||
    state.clock.nowS() < counters.disconnectedAtS + deadlineOffsetS
  ) {
    return;
  }

  state.counters.set({ ...counters, attemptInFlight: true });
  void runAttempt(options, state);
}

export function createReconnectController(
  options: ReconnectControllerOptions,
): ReconnectController {
  const state: ReconnectState = {
    generation: createCell(0),
    deadlines: RECONNECT_ATTEMPT_DEADLINES_S,
    clock: options.clock,
    phase: createCell<ReconnectPhase>("idle"),
    counters: createCell<ReconnectCounters>({
      attemptIndex: 0,
      disconnectedAtS: 0,
      attemptInFlight: false,
    }),
  };

  options.ticker.start(() => {
    dueAttempt(options, state);
  });

  return {
    disconnected() {
      if (state.phase.get() !== "idle") {
        return;
      }

      state.phase.set("scheduled");
      state.counters.set({
        attemptIndex: 0,
        disconnectedAtS: state.clock.nowS(),
        attemptInFlight: false,
      });
    },
    reset() {
      state.generation.set(state.generation.get() + 1);
      state.phase.set("idle");
      state.counters.set({ attemptIndex: 0, disconnectedAtS: 0, attemptInFlight: false });
    },
  };
}
