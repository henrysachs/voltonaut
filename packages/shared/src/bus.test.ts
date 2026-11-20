import { describe, expect, it } from "vitest";

import { createEventBus } from "./bus.js";
import type { DeviceEvent } from "./events.js";

describe("createEventBus", () => {
  it("delivers only the subscribed event type", () => {
    const bus = createEventBus();
    const received: DeviceEvent[] = [];
    bus.subscribe("trainer.data", (event) => {
      received.push(event);
    });

    bus.publish({ type: "hr.data", tS: 1, bpm: 120 });
    bus.publish({ type: "trainer.data", tS: 2, powerW: 150, cadenceRpm: 90 });

    expect(received).toEqual([{ type: "trainer.data", tS: 2, powerW: 150, cadenceRpm: 90 }]);
  });

  it("stops delivery after unsubscribe", () => {
    const bus = createEventBus();
    const received: number[] = [];

    const unsubscribe = bus.subscribe("hr.data", (event) => {
      received.push(event.bpm);
    });

    bus.publish({ type: "hr.data", tS: 1, bpm: 100 });
    unsubscribe();
    bus.publish({ type: "hr.data", tS: 2, bpm: 110 });

    expect(received).toEqual([100]);
  });

  it("keeps other listeners when one listener unsubscribes during publish", () => {
    const bus = createEventBus();
    const received: number[] = [];

    const unsubscribe = bus.subscribe("hr.data", () => {
      unsubscribe();
    });

    bus.subscribe("hr.data", (event) => {
      received.push(event.bpm);
    });

    bus.publish({ type: "hr.data", tS: 1, bpm: 140 });

    expect(received).toEqual([140]);
  });
});
