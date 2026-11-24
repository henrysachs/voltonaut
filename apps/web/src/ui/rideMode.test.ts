import { expect, it } from "vitest";

import type { RideMode } from "@voltonaut/shared";

import type { CaptureView } from "../game/rideCaptureProtocol.js";
import {
  bindRideMode,
  RIDE_MODE_COPY,
  UNRECORDABLE_LOCKED_HINT,
  type RideModeView,
} from "./rideMode.js";

const FUN_MODE_HINT = RIDE_MODE_COPY.fun.hint;
const FUN_MODE_LOCKED_HINT = UNRECORDABLE_LOCKED_HINT;

const idle: CaptureView = { kind: "idle", availability: { kind: "journal" } };

const recording: CaptureView = {
  kind: "recording",
  rideId: "550e8400-e29b-41d4-a716-446655440000",
  elapsedMs: 0,
  availability: { kind: "journal" },
};

function ignore(): void {}

interface ShownPicker {
  selected: RideMode;
  funEnabled: boolean;
  hint: string;
}

interface Listeners {
  change: (mode: RideMode) => void;
  capture: (view: CaptureView) => void;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fake view records what the binding shows into these mutable test probes.
function fakeView(shown: ShownPicker, listeners: Listeners): RideModeView {
  return {
    select: (mode) => {
      shown.selected = mode;
    },
    onChange: (listener) => {
      listeners.change = listener;

      return ignore;
    },
    setEnabled: (mode, enabled) => {
      if (mode === "fun") shown.funEnabled = enabled;
      else if (!enabled) throw new Error(`${mode} must stay selectable`);
    },
    setHint: (text) => {
      shown.hint = text;
    },
  };
}

function harness(initial: CaptureView = idle) {
  let captureView = initial;
  const listeners: Listeners = { change: ignore, capture: ignore };
  const sent: RideMode[] = [];
  const shown: ShownPicker = { selected: "normal", funEnabled: true, hint: "" };

  bindRideMode(fakeView(shown, listeners), {
    setMode: (mode) => {
      sent.push(mode);
    },
    recording: {
      state: () => captureView,
      subscribe: (listener) => {
        listeners.capture = listener;

        return ignore;
      },
    },
  });

  const choose = (mode: RideMode) => {
    listeners.change(mode);
  };

  const capture = (next: CaptureView) => {
    captureView = next;
    listeners.capture(next);
  };

  return { sent, shown, choose, capture };
}

it("starts in normal mode and switches to fun with a hint", () => {
  const ride = harness();

  expect(ride.shown).toEqual({ selected: "normal", funEnabled: true, hint: "" });
  ride.choose("fun");
  expect(ride.sent).toEqual(["fun"]);
  expect(ride.shown.hint).toBe(FUN_MODE_HINT);
  ride.choose("normal");
  expect(ride.sent).toEqual(["fun", "normal"]);
  expect(ride.shown.hint).toBe("");
});

it("locks fun mode while a recording runs and unlocks afterwards", () => {
  const ride = harness();

  ride.capture(recording);
  expect(ride.shown).toEqual({ selected: "normal", funEnabled: false, hint: FUN_MODE_LOCKED_HINT });
  ride.capture(idle);
  expect(ride.shown).toEqual({ selected: "normal", funEnabled: true, hint: "" });
});

it("reverts a fun choice that races a running recording", () => {
  const ride = harness(recording);

  ride.choose("fun");
  expect(ride.sent).toEqual([]);
  expect(ride.shown).toEqual({ selected: "normal", funEnabled: false, hint: FUN_MODE_LOCKED_HINT });
});

it("falls back to normal when a recording wins the race against a fun choice", () => {
  const ride = harness();

  ride.choose("fun");
  ride.capture(recording);
  expect(ride.sent).toEqual(["fun", "normal"]);
  expect(ride.shown).toEqual({ selected: "normal", funEnabled: false, hint: FUN_MODE_LOCKED_HINT });
});
