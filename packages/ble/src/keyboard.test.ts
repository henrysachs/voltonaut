import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import type { KeyboardEventLike, KeyboardSource } from "./keyboard.js";
import { createKeyboardAdapter } from "./keyboard.js";
import { createManualClock } from "./sim/clock.js";

type KeyboardListener = (phase: "keydown" | "keyup", event: KeyboardEventLike) => void;

interface FakeKeyboardHarness {
  readonly source: KeyboardSource;
  readonly emit: (phase: "keydown" | "keyup", key: string) => void;
}

function createFakeKeyboardSource(): FakeKeyboardHarness {
  let listener: KeyboardListener | undefined;

  return {
    source: {
      subscribe(nextListener) {
        listener = nextListener;

        return () => {
          listener = undefined;
        };
      },
    },
    emit(phase, key) {
      listener?.(phase, { key });
    },
  };
}

describe("createKeyboardAdapter", () => {
  it("maps arrow keys to shift buttons without repeats or double releases", async () => {
    const bus = createEventBus();
    const clock = createManualClock();
    const keyboardSource = createFakeKeyboardSource();
    const events: DeviceEvent[] = [];
    bus.subscribe("controller.button", (event) => {
      events.push(event);
    });

    const keyboard = createKeyboardAdapter({ bus, clock, source: keyboardSource.source });
    await keyboard.connect();

    keyboardSource.emit("keydown", "ArrowUp");
    keyboardSource.emit("keydown", "ArrowUp");
    keyboardSource.emit("keyup", "ArrowUp");
    keyboardSource.emit("keyup", "ArrowUp");
    keyboardSource.emit("keydown", "ArrowDown");
    keyboardSource.emit("keyup", "ArrowDown");
    keyboardSource.emit("keydown", "Space");

    expect(events).toEqual([
      { type: "controller.button", tS: 0, button: "shiftUp", pressed: true, source: "keyboard" },
      { type: "controller.button", tS: 0, button: "shiftUp", pressed: false, source: "keyboard" },
      { type: "controller.button", tS: 0, button: "shiftDown", pressed: true, source: "keyboard" },
      { type: "controller.button", tS: 0, button: "shiftDown", pressed: false, source: "keyboard" },
    ]);
  });

  it("stops emitting after disconnect and reports the status", async () => {
    const bus = createEventBus();
    const clock = createManualClock();
    const keyboardSource = createFakeKeyboardSource();
    const events: DeviceEvent[] = [];
    bus.subscribe("controller.button", (event) => {
      events.push(event);
    });

    const keyboard = createKeyboardAdapter({ bus, clock, source: keyboardSource.source });
    await keyboard.connect();
    await keyboard.disconnect();

    keyboardSource.emit("keydown", "ArrowUp");

    expect(events).toHaveLength(0);
    expect(keyboard.status()).toBe("disconnected");
  });
});
