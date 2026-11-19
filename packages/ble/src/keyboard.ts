import type { ControllerButton, DeviceAdapter, EventBus } from "@voltonaut/shared";

import type { SimClock } from "./sim/clock.js";
import type { Unsubscribe } from "./sim/tick.js";

export interface KeyboardEventLike {
  readonly key: string;
}

export interface KeyboardSource {
  subscribe(listener: (phase: "keydown" | "keyup", event: KeyboardEventLike) => void): Unsubscribe;
}

export interface KeyboardAdapterOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly source: KeyboardSource;
  readonly id?: string;
}

export interface KeyboardAdapter extends DeviceAdapter {}

function keyToButton(key: string): ControllerButton | undefined {
  if (key === "ArrowUp") {
    return "shiftUp";
  }

  if (key === "ArrowDown") {
    return "shiftDown";
  }

  return undefined;
}

export function createKeyboardAdapter(options: KeyboardAdapterOptions): KeyboardAdapter {
  const { bus, clock, source } = options;
  const id = options.id ?? "keyboard";
  const pressedButtons = new Set<ControllerButton>();
  let status: "disconnected" | "ready" = "disconnected";
  let unsubscribe: Unsubscribe | undefined;

  const publish = (button: ControllerButton, pressed: boolean): void => {
    bus.publish({
      type: "controller.button",
      tS: clock.nowS(),
      button,
      pressed,
      source: id,
    });
  };

  return {
    kind: "keyboard",
    id,
    connect() {
      status = "ready";
      unsubscribe = source.subscribe((phase, event) => {
        const button = keyToButton(event.key);

        if (button === undefined) {
          return;
        }

        if (phase === "keydown") {
          if (pressedButtons.has(button)) {
            return;
          }

          pressedButtons.add(button);
          publish(button, true);

          return;
        }

        if (!pressedButtons.delete(button)) {
          return;
        }

        publish(button, false);
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
