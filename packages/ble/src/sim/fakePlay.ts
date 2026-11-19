import type { ControllerButton, DeviceAdapter, EventBus } from "@voltonaut/shared";

import type { SimClock } from "./clock.js";

export interface FakePlayOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly id?: string;
}

export interface FakePlay extends DeviceAdapter {
  pressShiftUp(): void;
  pressShiftDown(): void;
}

export function createFakePlay(options: FakePlayOptions): FakePlay {
  const { bus, clock } = options;
  const id = options.id ?? "sim-play";
  let status: "disconnected" | "ready" = "disconnected";

  const press = (button: ControllerButton): void => {
    bus.publish({
      type: "controller.button",
      tS: clock.nowS(),
      button,
      pressed: true,
      source: id,
    });
    bus.publish({
      type: "controller.button",
      tS: clock.nowS(),
      button,
      pressed: false,
      source: id,
    });
  };

  return {
    kind: "controller",
    id,
    connect() {
      status = "ready";
      bus.publish({ type: "device.status", tS: clock.nowS(), kind: "controller", id, status });

      return Promise.resolve();
    },
    disconnect() {
      status = "disconnected";
      bus.publish({ type: "device.status", tS: clock.nowS(), kind: "controller", id, status });

      return Promise.resolve();
    },
    status: () => status,
    pressShiftUp() {
      press("shiftUp");
    },
    pressShiftDown() {
      press("shiftDown");
    },
  };
}
