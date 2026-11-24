import type { EventBus, TrainerCommand } from "@voltonaut/shared";
import {
  createFakeHeartRate,
  createFakePlay,
  createFakeTrainer,
  createIntervalTicker,
  createKeyboardAdapter,
  createSimScript,
  createTrainerAdapter,
  createHeartRateAdapter,
  createPlayAdapter,
  createNavigatorBluetoothCentral,
  createWebBluetoothTransport,
  type KeyboardSource,
  type PlayAdapterOptions,
  type WebBluetoothCentral,
  type TrainerControl,
  type SimulationCommand,
} from "@voltonaut/ble";
import type { RideSnapshot } from "@voltonaut/engine";
import { mountConnectDialog } from "./ui/connect/dialog.js";

const SIM_SAMPLES = createSimScript([
  { powerW: 142, cadenceRpm: 88, heartRateBpm: 122, gearIndex: 0 },
  { powerW: 176, cadenceRpm: 94, heartRateBpm: 128, gearIndex: 0 },
  { powerW: 205, cadenceRpm: 99, heartRateBpm: 134, gearIndex: 0 },
  { powerW: 168, cadenceRpm: 91, heartRateBpm: 130, gearIndex: 0 },
]);

// oxlint-disable typescript/prefer-readonly-parameter-types -- DOM listener signatures include EventTarget; native KeyboardEvent values are only inspected.
interface WindowKeyboardTarget {
  readonly addEventListener: (
    type: "keydown" | "keyup",
    listener: (event: Readonly<KeyboardEvent>) => void,
  ) => void;
  readonly removeEventListener: (
    type: "keydown" | "keyup",
    listener: (event: Readonly<KeyboardEvent>) => void,
  ) => void;
}
// oxlint-enable typescript/prefer-readonly-parameter-types

function visibleRideMenu(): boolean {
  for (const element of document.querySelectorAll(
    "dialog[open], [role='dialog'][aria-modal='true'], [role='menu']",
  )) {
    if (element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true")
      return true;
  }

  return false;
}

export function createWindowKeyboardSource(window: WindowKeyboardTarget): KeyboardSource {
  return {
    subscribe(listener) {
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM KeyboardEvent is the native listener contract; it is inspected, never modified.
      const keydown = (event: KeyboardEvent): void => {
        const target = event.target;

        if (
          event.defaultPrevented ||
          visibleRideMenu() ||
          (target instanceof Element &&
            target.closest(
              "input, textarea, select, form, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='spinbutton'], [role='combobox']",
            ) !== null)
        )
          return;
        listener("keydown", { key: event.key });
      };

      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Key-up must clear held state even after focus moves into a modal.
      const keyup = (event: KeyboardEvent): void => {
        listener("keyup", { key: event.key });
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

export interface RideDevices {
  readonly mount: () => void;
  readonly onCommands: (commands: readonly TrainerCommand[]) => void;
  readonly onSnapshot: (snapshot: RideSnapshot) => void;
}

/** An unchanged engine target is current only while worker snapshots and fresh cadence continue. */
function commandSink(control: TrainerControl): Pick<RideDevices, "onCommands" | "onSnapshot"> {
  let latest: SimulationCommand | undefined;
  let riding = false;

  return {
    onSnapshot(snapshot) {
      riding = !snapshot.paused && snapshot.cadenceRpm > 0;
    },
    onCommands(commands) {
      for (const command of commands) if (command.type === "simulation") latest = command;

      if (riding && latest !== undefined) control.submit(latest);
    },
  };
}

export function setupSimDevices(bus: EventBus, clockScale: number): RideDevices {
  const ticker = createIntervalTicker(250 / clockScale);
  const clock = { nowS: (): number => performance.now() / 1000 };
  const trainer = createFakeTrainer({ bus, clock, ticker, samples: SIM_SAMPLES });
  const heartRate = createFakeHeartRate({ bus, clock, ticker, samples: SIM_SAMPLES });
  const play = createFakePlay({ bus, clock });

  return {
    ...commandSink(trainer.control),
    mount() {
      mountConnectDialog(
        [
          {
            label: "Trainer",
            adapter: trainer,
            select: () => trainer.connect(),
            trainer: { control: trainer.control, clockScale },
          },
          { label: "Pulsgurt", adapter: heartRate, select: () => heartRate.connect() },
        ],
        bus,
      );
      void Promise.all([trainer, heartRate, play].map((device) => device.connect()));
    },
  };
}

function playSlots(
  options: Omit<PlayAdapterOptions, "side" | "transport">,
  central: WebBluetoothCentral,
) {
  return (["left", "right"] satisfies readonly ("left" | "right")[]).map((side) => {
    const adapter = createPlayAdapter({
      ...options,
      side,
      transport: createWebBluetoothTransport({ central }),
    });

    return {
      label: side === "left" ? "Linker Play-Griff" : "Rechter Play-Griff",
      adapter,
      select: adapter.select,
      description: adapter.description,
    };
  });
}

export function setupBluetoothDevices(bus: EventBus, clockScale: number): RideDevices | undefined {
  const central = createNavigatorBluetoothCentral();

  if (central === undefined) {
    const warning = document.createElement("p");
    warning.textContent =
      "Web Bluetooth benötigt Chrome/Edge und HTTPS oder localhost. Sim-Modus: ?sim=1";
    document.body.append(warning);

    return undefined;
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

  return {
    ...commandSink(trainer.control),
    mount() {
      mountConnectDialog(
        [
          {
            label: "Trainer",
            adapter: trainer,
            select: trainer.select,
            trainer: { control: trainer.control, clockScale },
          },
          { label: "Pulsgurt", adapter: heartRate, select: heartRate.select },
          ...playSlots({ bus, clock, ticker }, central),
        ],
        bus,
      );
    },
  };
}
