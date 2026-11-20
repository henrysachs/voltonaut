import type { Bpm, Mps, Rpm, Seconds, Watts } from "./units.js";

export type DeviceKind = "trainer" | "heartRate" | "controller" | "keyboard";

export type ControllerButton =
  | "shiftUp"
  | "shiftDown"
  | "navUp"
  | "navDown"
  | "navLeft"
  | "navRight"
  | "confirm"
  | "back"
  | "powerUp"
  | "brake";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "handshaking"
  | "ready"
  | "reconnecting"
  | "error";

export type TrainerControlResult =
  | "success"
  | "notSupported"
  | "invalidParam"
  | "failed"
  | "notPermitted";

export type DeviceEvent =
  | {
      readonly type: "trainer.data";
      readonly tS: Seconds;
      readonly powerW?: Watts;
      readonly cadenceRpm?: Rpm;
      readonly speedMps?: Mps;
    }
  | {
      readonly type: "hr.data";
      readonly tS: Seconds;
      readonly bpm: Bpm;
      readonly rrMs?: readonly number[];
    }
  | {
      readonly type: "controller.button";
      readonly tS: Seconds;
      readonly button: ControllerButton;
      readonly pressed: boolean;
      readonly source: string;
    }
  | { readonly type: "controller.battery"; readonly tS: Seconds; readonly percent: number }
  | {
      readonly type: "trainer.controlResult";
      readonly tS: Seconds;
      readonly opCode: number;
      readonly result: TrainerControlResult;
    }
  | {
      readonly type: "device.status";
      readonly tS: Seconds;
      readonly kind: DeviceKind;
      readonly id: string;
      readonly status: ConnectionStatus;
    };

export interface DeviceAdapter {
  readonly kind: DeviceKind;
  readonly id: string;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly status: () => ConnectionStatus;
}
