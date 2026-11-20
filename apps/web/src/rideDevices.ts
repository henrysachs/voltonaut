import type { EventBus } from "@voltonaut/shared";
import {
  createFakeHeartRate,
  createFakePlay,
  createFakeTrainer,
  createIntervalTicker,
  createKeyboardAdapter,
  createSimScript,
  createTrainerAdapter,
  createHeartRateAdapter,
  createNavigatorBluetoothCentral,
  createWebBluetoothTransport,
  type KeyboardEventLike,
  type KeyboardSource,
} from "@voltonaut/ble";
import { mountConnectDialog } from "./ui/connect/dialog.js";

const SIM_SAMPLES = createSimScript([
  { powerW: 142, cadenceRpm: 88, heartRateBpm: 122, gearIndex: 0 },
  { powerW: 176, cadenceRpm: 94, heartRateBpm: 128, gearIndex: 0 },
  { powerW: 205, cadenceRpm: 99, heartRateBpm: 134, gearIndex: 0 },
  { powerW: 168, cadenceRpm: 91, heartRateBpm: 130, gearIndex: 0 },
]);

interface WindowKeyboardTarget {
  readonly addEventListener: (
    type: "keydown" | "keyup",
    listener: (event: KeyboardEventLike) => void,
  ) => void;
  readonly removeEventListener: (
    type: "keydown" | "keyup",
    listener: (event: KeyboardEventLike) => void,
  ) => void;
}

function createWindowKeyboardSource(window: WindowKeyboardTarget): KeyboardSource {
  return {
    subscribe(listener) {
      const keydown = (event: KeyboardEventLike): void => {
        listener("keydown", event);
      };

      const keyup = (event: KeyboardEventLike): void => {
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

export function setupKeyboard(bus: EventBus): void {
  const keyboard = createKeyboardAdapter({
    bus,
    clock: { nowS: () => performance.now() / 1000 },
    source: createWindowKeyboardSource(window),
  });

  void keyboard.connect();
}

export function setupSimDevices(bus: EventBus, clockScale: number): void {
  const ticker = createIntervalTicker(250 / clockScale);
  const clock = { nowS: (): number => performance.now() / 1000 };
  const trainer = createFakeTrainer({ bus, clock, ticker, samples: SIM_SAMPLES });
  const heartRate = createFakeHeartRate({ bus, clock, ticker, samples: SIM_SAMPLES });
  const play = createFakePlay({ bus, clock });
  mountConnectDialog(
    [
      { label: "Trainer", adapter: trainer, select: () => trainer.connect() },
      { label: "Puls", adapter: heartRate, select: () => heartRate.connect() },
    ],
    bus,
  );
  void Promise.all([trainer, heartRate, play].map((device) => device.connect()));
}

export function setupBluetoothDevices(bus: EventBus): void {
  const central = createNavigatorBluetoothCentral();

  if (central === undefined) {
    const warning = document.createElement("p");
    warning.textContent =
      "Web Bluetooth benötigt Chrome/Edge und HTTPS oder localhost. Sim-Modus: ?sim=1";
    document.body.append(warning);

    return;
  }

  const clock = { nowS: (): number => performance.now() / 1000 };
  const ticker = createIntervalTicker(100);

  const trainer = createTrainerAdapter({
    bus,
    clock,
    ticker,
    transport: createWebBluetoothTransport({ central }),
  });

  const heartRate = createHeartRateAdapter({
    bus,
    clock,
    ticker,
    transport: createWebBluetoothTransport({ central }),
  });

  mountConnectDialog(
    [
      { label: "Trainer", adapter: trainer, select: trainer.select },
      { label: "Puls", adapter: heartRate, select: heartRate.select },
    ],
    bus,
  );
}
