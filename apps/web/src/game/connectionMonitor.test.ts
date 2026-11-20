import { describe, expect, it } from "vitest";

import { createEventBus, type EventBus } from "@voltonaut/shared";

import { createConnectionMonitor } from "./connectionMonitor.js";

describe("createConnectionMonitor", () => {
  it("is disconnected until a device reaches ready", () => {
    const bus: EventBus = createEventBus();
    const monitor = createConnectionMonitor(bus);

    expect(monitor.state()).toEqual({ connected: false });

    bus.publish({ type: "device.status", tS: 0, kind: "trainer", id: "t1", status: "connecting" });

    expect(monitor.state()).toEqual({ connected: false });

    bus.publish({ type: "device.status", tS: 1, kind: "trainer", id: "t1", status: "ready" });

    expect(monitor.state()).toEqual({ connected: true });
  });

  it("stays connected while one of several devices stays ready", () => {
    const bus: EventBus = createEventBus();
    const monitor = createConnectionMonitor(bus);

    bus.publish({ type: "device.status", tS: 0, kind: "trainer", id: "t1", status: "ready" });
    bus.publish({ type: "device.status", tS: 1, kind: "heartRate", id: "hr1", status: "ready" });
    bus.publish({ type: "device.status", tS: 2, kind: "trainer", id: "t1", status: "error" });

    expect(monitor.state()).toEqual({ connected: true });

    bus.publish({
      type: "device.status",
      tS: 3,
      kind: "heartRate",
      id: "hr1",
      status: "disconnected",
    });

    expect(monitor.state()).toEqual({ connected: false });
  });

  it("stops listening after dispose", () => {
    const bus: EventBus = createEventBus();
    const monitor = createConnectionMonitor(bus);

    monitor.dispose();

    bus.publish({ type: "device.status", tS: 0, kind: "trainer", id: "t1", status: "ready" });

    expect(monitor.state()).toEqual({ connected: false });
  });
});
