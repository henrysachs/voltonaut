import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createKeyboardAdapter } from "./keyboard.js";
import type { KeyboardSource } from "./keyboard.js";
import { createManualClock } from "./sim/clock.js";

type KeyboardListener = (phase: "keydown" | "keyup", event: { key: string }) => void;

function createFakeKeyboardSource(): {
  source: KeyboardSource;
  emit(phase: "keydown" | "keyup", key: string): void;
} {
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
});
