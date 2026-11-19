import { createEventBus, type DeviceAdapter } from "@voltonaut/shared";

import {
  createFakeHeartRate,
  createFakePlay,
  createFakeTrainer,
  createIntervalTicker,
  createKeyboardAdapter,
  createSimScript,
  type KeyboardSource,
} from "@voltonaut/ble";

import { startApp } from "./app.js";
import { createSimRide } from "./game/simRide.js";

const SIM_SAMPLES = createSimScript([
  { powerW: 142, cadenceRpm: 88, heartRateBpm: 122, gearIndex: 0 },
  { powerW: 176, cadenceRpm: 94, heartRateBpm: 128, gearIndex: 0 },
  { powerW: 205, cadenceRpm: 99, heartRateBpm: 134, gearIndex: 0 },
  { powerW: 168, cadenceRpm: 91, heartRateBpm: 130, gearIndex: 0 },
]);

function createWindowKeyboardSource(window: Window): KeyboardSource {
  return {
    subscribe(listener) {
      const keydown = (event: KeyboardEvent): void => {
        listener("keydown", event);
      };

      const keyup = (event: KeyboardEvent): void => {
        listener("keyup", event);
      };

      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);

      return () => {
        window.removeEventListener("keydown", keydown);
        window.removeEventListener("keyup", keyup);
      };
    },
  };
}

async function connectDevices(devices: readonly DeviceAdapter[]): Promise<void> {
  for (const device of devices) {
    await device.connect();
  }
}

function startSimApp(): void {
  const bus = createEventBus();
  const ticker = createIntervalTicker(250);
  const ride = createSimRide({ bus });

  const trainer = createFakeTrainer({
    bus,
    clock: { nowS: () => 0 },
    ticker,
    samples: SIM_SAMPLES,
  });

  const heartRate = createFakeHeartRate({
    bus,
    clock: { nowS: () => 0 },
    ticker,
    samples: SIM_SAMPLES,
  });

  const play = createFakePlay({ bus, clock: { nowS: () => 0 } });

  const keyboard = createKeyboardAdapter({
    bus,
    clock: { nowS: () => 0 },
    source: createWindowKeyboardSource(window),
  });

  startApp({ document, ride });
  void connectDevices([trainer, heartRate, play, keyboard]);
}

function startOfflineApp(): void {
  const bus = createEventBus();
  const ride = createSimRide({ bus });

  startApp({ document, ride });
}

if (new URLSearchParams(window.location.search).get("sim") === "1") {
  startSimApp();
} else {
  startOfflineApp();
}
