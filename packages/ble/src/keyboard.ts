import type { ControllerButton, DeviceAdapter, EventBus } from "@voltonaut/shared";

import type { SimClock } from "./sim/clock.js";
import type { Unsubscribe } from "./sim/tick.js";

export interface KeyboardEventLike {
  readonly key: string;
}

export interface KeyboardSource {
  readonly subscribe: (
    listener: (phase: "keydown" | "keyup", event: KeyboardEventLike) => void,
  ) => Unsubscribe;
}

export interface KeyboardAdapterOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly source: KeyboardSource;
  readonly id?: string;
}

export interface KeyboardAdapter extends DeviceAdapter {}

type KeyPhase = "keydown" | "keyup";

interface KeyPress {
  readonly button: ControllerButton;
  readonly pressed: boolean;
}

function keyToButton(key: string): ControllerButton | undefined {
  if (key === "ArrowUp") {
    return "shiftUp";
  }

  if (key === "ArrowDown") {
    return "shiftDown";
  }

  if (key === "p" || key === "P") {
    return "powerUp";
  }

  return undefined;
}

function keyEventOutcome(
  phase: KeyPhase,
  event: KeyboardEventLike,
  isHeld: (button: ControllerButton) => boolean,
): KeyPress | undefined {
  const button = keyToButton(event.key);

  if (button === undefined) {
    return undefined;
  }

  if (phase === "keydown") {
    return isHeld(button) ? undefined : { button, pressed: true };
  }

  return isHeld(button) ? { button, pressed: false } : undefined;
}

function publishButton(
  bus: EventBus,
  clock: SimClock,
  id: string,
  button: ControllerButton,
  pressed: boolean,
): void {
  bus.publish({ type: "controller.button", tS: clock.nowS(), button, pressed, source: id });
}

export function createKeyboardAdapter(options: KeyboardAdapterOptions): KeyboardAdapter {
  const { bus, clock, source } = options;
  const id = options.id ?? "keyboard";
  const pressedButtons = new Set<ControllerButton>();
  let status: "disconnected" | "ready" = "disconnected";
  let unsubscribe: Unsubscribe | undefined;

  return {
    kind: "keyboard",
    id,
    connect() {
      status = "ready";
      unsubscribe = source.subscribe((phase, event) => {
        const outcome = keyEventOutcome(phase, event, (button) => pressedButtons.has(button));

        if (outcome === undefined) {
          return;
        }

        if (outcome.pressed) {
          pressedButtons.add(outcome.button);
        } else {
          pressedButtons.delete(outcome.button);
        }

        publishButton(bus, clock, id, outcome.button, outcome.pressed);
      });
      bus.publish({ type: "device.status", tS: clock.nowS(), kind: "keyboard", id, status });

      return Promise.resolve();
    },
    disconnect() {
      unsubscribe?.();
      unsubscribe = undefined;
      status = "disconnected";
      bus.publish({ type: "device.status", tS: clock.nowS(), kind: "keyboard", id, status });

      return Promise.resolve();
    },
    status: () => status,
  };
}
