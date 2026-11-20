import { createEventBus } from "@voltonaut/shared";
import type { ConnectionStatus, ControllerButton, EventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createSimRide } from "./simRide.js";

function publishShift(bus: EventBus, tS: number, button: ControllerButton, pressed: boolean): void {
  bus.publish({ type: "controller.button", tS, button, pressed, source: "test" });
}

function publishStatus(bus: EventBus, tS: number, id: string, status: ConnectionStatus): void {
  bus.publish({ type: "device.status", tS, kind: "trainer", id, status });
}

describe("createSimRide", () => {
  it("tracks trainer, heart rate, gear, and connection state", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus });

    bus.publish({ type: "trainer.data", tS: 1, powerW: 180, cadenceRpm: 92 });
    bus.publish({ type: "hr.data", tS: 1, bpm: 131 });
    publishShift(bus, 1, "shiftUp", true);
    publishStatus(bus, 1, "sim", "ready");

    expect(ride.state()).toEqual({
      powerW: 180,
      cadenceRpm: 92,
      heartRateBpm: 131,
      gearIndex: 1,
      connected: true,
    });
  });

  it("ignores button releases and clamps gear shifts at both ends", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus, initialGearIndex: 0 });

    publishShift(bus, 1, "shiftDown", true);
    expect(ride.state().gearIndex).toBe(0);

    publishShift(bus, 2, "shiftUp", true);
    publishShift(bus, 3, "shiftUp", false);
    expect(ride.state().gearIndex).toBe(1);
  });
});

describe("createSimRide connection tracking", () => {
  it("marks the ride disconnected when the last device disconnects", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus });

    publishStatus(bus, 1, "a", "ready");
    publishStatus(bus, 2, "b", "ready");
    expect(ride.state().connected).toBe(true);

    publishStatus(bus, 3, "a", "disconnected");
    expect(ride.state().connected).toBe(true);

    publishStatus(bus, 4, "b", "disconnected");
    expect(ride.state().connected).toBe(false);
  });

  it("stops tracking events after dispose", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus });

    ride.dispose();
    bus.publish({ type: "trainer.data", tS: 1, powerW: 200, cadenceRpm: 95 });

    expect(ride.state().powerW).toBe(0);
  });
});
