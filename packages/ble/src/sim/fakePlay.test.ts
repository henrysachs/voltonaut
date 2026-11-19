import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createManualClock } from "./clock.js";
import { createFakePlay } from "./fakePlay.js";

describe("createFakePlay", () => {
  it("publishes one press and one release per shift button", async () => {
    const bus = createEventBus();
    const clock = createManualClock(5);
    const events: DeviceEvent[] = [];
    bus.subscribe("controller.button", (event) => {
      events.push(event);
    });

    const play = createFakePlay({ bus, clock });
    await play.connect();
    play.pressShiftUp();
    play.pressShiftDown();

    expect(events).toEqual([
      { type: "controller.button", tS: 5, button: "shiftUp", pressed: true, source: "sim-play" },
      { type: "controller.button", tS: 5, button: "shiftUp", pressed: false, source: "sim-play" },
      { type: "controller.button", tS: 5, button: "shiftDown", pressed: true, source: "sim-play" },
      { type: "controller.button", tS: 5, button: "shiftDown", pressed: false, source: "sim-play" },
    ]);
  });
});
