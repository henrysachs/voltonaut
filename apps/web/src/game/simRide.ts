import { shiftGearIndex } from "@voltonaut/engine";
import type { EventBus } from "@voltonaut/shared";

export interface HudState {
  readonly powerW: number;
  readonly cadenceRpm: number;
  readonly heartRateBpm: number;
  readonly gearIndex: number;
  readonly connected: boolean;
}

export interface SimRideOptions {
  readonly bus: EventBus;
  readonly initialGearIndex?: number;
}

export interface SimRide {
  state(): HudState;
  dispose(): void;
}

export function createSimRide(options: SimRideOptions): SimRide {
  const { bus } = options;
  const readyDevices = new Set<string>();

  let state: HudState = {
    powerW: 0,
    cadenceRpm: 0,
    heartRateBpm: 0,
    gearIndex: options.initialGearIndex ?? 0,
    connected: false,
  };

  const unsubscribeTrainer = bus.subscribe("trainer.data", (event) => {
    state = {
      ...state,
      powerW: event.powerW ?? state.powerW,
      cadenceRpm: event.cadenceRpm ?? state.cadenceRpm,
    };
  });

  const unsubscribeHeartRate = bus.subscribe("hr.data", (event) => {
    state = { ...state, heartRateBpm: event.bpm };
  });

  const unsubscribeController = bus.subscribe("controller.button", (event) => {
    if (!event.pressed) {
      return;
    }

    if (event.button !== "shiftUp" && event.button !== "shiftDown") {
      return;
    }

    state = {
      ...state,
      gearIndex: shiftGearIndex(state.gearIndex, event.button === "shiftUp" ? "up" : "down"),
    };
  });

  const unsubscribeStatus = bus.subscribe("device.status", (event) => {
    if (event.status === "ready") {
      readyDevices.add(event.id);
    } else {
      readyDevices.delete(event.id);
    }

    state = { ...state, connected: readyDevices.size > 0 };
  });

  return {
    state: () => state,
    dispose() {
      unsubscribeTrainer();
      unsubscribeHeartRate();
      unsubscribeController();
      unsubscribeStatus();
    },
  };
}
