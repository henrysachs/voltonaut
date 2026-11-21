import type { SimClock } from "../sim/clock.js";
import type { TickSource, Unsubscribe } from "../sim/tick.js";
import type { ControlTransport } from "./controlProcedure.js";
import type { SimulationCommand } from "./controlCodec.js";

export const SIM_INTERVAL_S = 0.25;
export const FRESH_S = 1.5;

export type TrainerAuthority =
  | { readonly kind: "inactive"; readonly reason: string }
  | { readonly kind: "acquiring"; readonly step: "control" | "start" | "neutral" | "stopping" }
  | { readonly kind: "active" }
  | { readonly kind: "lost"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string; readonly reconnectRequired: boolean };

export interface TrainerControlView {
  readonly authority: TrainerAuthority;
  readonly available: boolean;
  readonly target: SimulationCommand | undefined;
  readonly acknowledged: SimulationCommand | undefined;
  readonly hardware: "unknown" | "neutralAcknowledged" | "targetAcknowledged" | "stopAcknowledged";
}

export interface TrainerControl {
  readonly enable: (clockScale?: number) => Promise<void>;
  readonly disable: () => Promise<void>;
  readonly submit: (command: SimulationCommand) => void;
  readonly view: () => TrainerControlView;
  readonly subscribe: (listener: () => void) => Unsubscribe;
}

export interface ControlOptions {
  readonly transport: ControlTransport;
  readonly clock: SimClock;
  readonly ticker: TickSource;
}
