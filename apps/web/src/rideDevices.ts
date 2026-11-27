import type { EventBus } from "@voltonaut/shared";
import {
  createBluetoothDeviceTransports,
  createIntervalTicker,
  createKeyboardAdapter,
  createNavigatorBluetoothCentral,
  createRideDeviceSet,
  createSimDeviceTransports,
  createSimScript,
  type DeviceTransports,
  type KeyboardSource,
} from "@voltonaut/ble";
import type { RideTrainerSink } from "./game/rideSession.js";
import { mountConnectDialog, type ConnectSlot } from "./ui/connect/dialog.js";
import { bindHudResistance } from "./ui/hudTrainerControl.js";

/** The HUD's resistance indicator; absent in pages without the ride HUD. */
function mountHudResistance(control: Parameters<typeof bindHudResistance>[0]): void {
  const root = document.querySelector("#hud-resistance");
  const state = document.querySelector("#hud-resistance-state");
  const grade = document.querySelector("#hud-resistance-grade");

  const present =
    root instanceof HTMLElement && state instanceof HTMLElement && grade instanceof HTMLElement;

  if (!present) return;

  bindHudResistance(control, {
    write: (kind, text, gradeText) => {
      root.dataset["state"] = kind;
      root.hidden = kind === "hidden";
      state.textContent = text;
      grade.textContent = gradeText === "" ? "" : ` · ${gradeText}`;
    },
  });
}

const SIM_SAMPLES = createSimScript([
  { powerW: 142, cadenceRpm: 88, heartRateBpm: 122 },
  { powerW: 176, cadenceRpm: 94, heartRateBpm: 128 },
  { powerW: 205, cadenceRpm: 99, heartRateBpm: 134 },
  { powerW: 168, cadenceRpm: 91, heartRateBpm: 130 },
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

function createWindowKeyboardSource(window: WindowKeyboardTarget): KeyboardSource {
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

export interface RideDevices extends RideTrainerSink {
  readonly mount: () => void;
}

/** Where ride devices come from. Only the composition root picks one. */
export interface DeviceSource {
  readonly transports: DeviceTransports;
  /** Sim peripherals need no picker and connect at mount; native devices wait for a user click. */
  readonly connectOnMount: boolean;
}

export function simDeviceSource(clockScale: number): DeviceSource {
  return {
    transports: createSimDeviceTransports({
      ticker: createIntervalTicker(250 / clockScale),
      samples: SIM_SAMPLES,
    }),
    connectOnMount: true,
  };
}

export function bluetoothDeviceSource(): DeviceSource | undefined {
  const central = createNavigatorBluetoothCentral();

  if (central === undefined) {
    const warning = document.createElement("p");
    warning.textContent =
      "Web Bluetooth benötigt Chrome/Edge und HTTPS oder localhost. Sim-Modus: ?sim=1";
    document.body.append(warning);

    return undefined;
  }

  return { transports: createBluetoothDeviceTransports(central), connectOnMount: false };
}

export function setupRideDevices(
  bus: EventBus,
  clockScale: number,
  source: DeviceSource,
): RideDevices {
  const { trainer, heartRate, play } = createRideDeviceSet({
    bus,
    clock: { nowS: (): number => performance.now() / 1000 },
    ticker: createIntervalTicker(100),
    clockScale,
    transports: source.transports,
  });

  const slots: readonly ConnectSlot[] = [
    { label: "Trainer", adapter: trainer },
    { label: "Pulsgurt", adapter: heartRate },
    ...play.map((adapter) => ({
      label: adapter.side === "left" ? "Linker Controller" : "Rechter Controller",
      adapter,
    })),
  ];

  return {
    forward(update) {
      trainer.control.forward(update);
    },
    mount() {
      mountConnectDialog(slots, bus);
      mountHudResistance(trainer.control);

      if (source.connectOnMount) {
        void Promise.all(slots.map((slot) => slot.adapter.connect()));
      }
    },
  };
}
