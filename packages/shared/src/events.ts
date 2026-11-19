import type { Bpm, Mps, Pct, Rpm, Seconds, Watts } from "./units.js";

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
      type: "trainer.data";
      tS: Seconds;
      powerW?: Watts;
      cadenceRpm?: Rpm;
      speedMps?: Mps;
    }
  | { type: "hr.data"; tS: Seconds; bpm: Bpm; rrMs?: number[] }
  | {
      type: "controller.button";
      tS: Seconds;
      button: ControllerButton;
      pressed: boolean;
      source: string;
    }
  | { type: "controller.battery"; tS: Seconds; percent: number }
  | {
      type: "trainer.controlResult";
      tS: Seconds;
      opCode: number;
      result: TrainerControlResult;
    }
  | {
      type: "device.status";
      tS: Seconds;
      kind: DeviceKind;
      id: string;
      status: ConnectionStatus;
    };

export type TrainerCommand =
  | {
      type: "simulation";
      gradePct: Pct;
      windMps: Mps;
      crr: number;
      cwKgPerM: number;
    }
  | { type: "targetPower"; powerW: Watts }
  | { type: "resistance"; level: number };

export interface DeviceAdapter {
  readonly kind: DeviceKind;
  readonly id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): ConnectionStatus;
}
