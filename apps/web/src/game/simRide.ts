import type { DeviceEvent, EventBus } from "@voltonaut/shared";
import { shiftGearIndex } from "@voltonaut/engine";

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
  readonly state: () => HudState;
  readonly dispose: () => void;
}

type TrainerDataEvent = Readonly<Extract<DeviceEvent, { type: "trainer.data" }>>;

type HeartRateEvent = Readonly<Extract<DeviceEvent, { type: "hr.data" }>>;

type ControllerButtonEvent = Readonly<Extract<DeviceEvent, { type: "controller.button" }>>;

type DeviceStatusEvent = Readonly<Extract<DeviceEvent, { type: "device.status" }>>;

function applyTrainerData(state: HudState, event: TrainerDataEvent): HudState {
  return {
    ...state,
    powerW: event.powerW ?? state.powerW,
    cadenceRpm: event.cadenceRpm ?? state.cadenceRpm,
  };
}

function applyHeartRate(state: HudState, event: HeartRateEvent): HudState {
  return { ...state, heartRateBpm: event.bpm };
}

function applyControllerButton(state: HudState, event: ControllerButtonEvent): HudState {
  if (!event.pressed) {
    return state;
  }

  if (event.button !== "shiftUp" && event.button !== "shiftDown") {
    return state;
  }

  return {
    ...state,
    gearIndex: shiftGearIndex(state.gearIndex, event.button === "shiftUp" ? "up" : "down"),
  };
}

function initialHudState(initialGearIndex: number): HudState {
  return {
    powerW: 0,
    cadenceRpm: 0,
    heartRateBpm: 0,
    gearIndex: initialGearIndex,
    connected: false,
  };
}

export function createSimRide(options: SimRideOptions): SimRide {
  const { bus } = options;
  const readyDevices = new Set<string>();

  let state: HudState = initialHudState(options.initialGearIndex ?? 0);

  const unsubscribeTrainer = bus.subscribe("trainer.data", (event) => {
    state = applyTrainerData(state, event);
  });

  const unsubscribeHeartRate = bus.subscribe("hr.data", (event) => {
    state = applyHeartRate(state, event);
  });

  const unsubscribeController = bus.subscribe("controller.button", (event) => {
    state = applyControllerButton(state, event);
  });

  const unsubscribeStatus = bus.subscribe("device.status", (event: DeviceStatusEvent) => {
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
