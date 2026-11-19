import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createSimRide } from "./simRide.js";

describe("createSimRide", () => {
  it("tracks trainer, heart rate, gear, and connection state", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus });

    bus.publish({ type: "trainer.data", tS: 1, powerW: 180, cadenceRpm: 92 });
    bus.publish({ type: "hr.data", tS: 1, bpm: 131 });
    bus.publish({
      type: "controller.button",
      tS: 1,
      button: "shiftUp",
      pressed: true,
      source: "test",
    });
    bus.publish({ type: "device.status", tS: 1, kind: "trainer", id: "sim", status: "ready" });

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

    bus.publish({
      type: "controller.button",
      tS: 1,
      button: "shiftDown",
      pressed: true,
      source: "test",
    });
    expect(ride.state().gearIndex).toBe(0);

    bus.publish({
      type: "controller.button",
      tS: 2,
      button: "shiftUp",
      pressed: true,
      source: "test",
    });
    bus.publish({
      type: "controller.button",
      tS: 3,
      button: "shiftUp",
      pressed: false,
      source: "test",
    });
    expect(ride.state().gearIndex).toBe(1);
  });

  it("marks the ride disconnected when the last device disconnects", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus });

    bus.publish({ type: "device.status", tS: 1, kind: "trainer", id: "a", status: "ready" });
    bus.publish({ type: "device.status", tS: 2, kind: "heartRate", id: "b", status: "ready" });
    expect(ride.state().connected).toBe(true);

    bus.publish({ type: "device.status", tS: 3, kind: "trainer", id: "a", status: "disconnected" });
    expect(ride.state().connected).toBe(true);

    bus.publish({
      type: "device.status",
      tS: 4,
      kind: "heartRate",
      id: "b",
      status: "disconnected",
    });
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
