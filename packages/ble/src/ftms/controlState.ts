import type { TrainerCommand } from "@voltonaut/shared";
import type { SimClock } from "../sim/clock.js";
import type { TickSource, Unsubscribe } from "../sim/tick.js";
import type { ControlTransport } from "./controlProcedure.js";
import type { SimulationCommand } from "./controlCodec.js";

/**
 * Wall-clock transport limit (at most four 0x11 writes per real second). The engine's
 * tick-based limit is ride time, deterministic and replayed by the server; it does not
 * bound BLE traffic under an accelerated or stalled ride clock, so both limits stay.
 */
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

/** What a user interface may do: observe authority and explicitly grant or withdraw it. */
export interface TrainerControlPanel {
  readonly enable: () => Promise<void>;
  readonly disable: () => Promise<void>;
  readonly view: () => TrainerControlView;
  readonly subscribe: (listener: () => void) => Unsubscribe;
}

/**
 * Callers forward every engine update's command batch, also when it is empty: each batch
 * proves the engine is alive. The trainer holds the latest simulation target and decides
 * from its own measurements whether it is still current; no caller resubmits or gates.
 */
export interface TrainerControl extends TrainerControlPanel {
  readonly forward: (commands: readonly TrainerCommand[]) => void;
}

export interface ControlOptions {
  readonly transport: ControlTransport;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  /** Ride clock scale, fixed at creation. Control is refused unless it is exactly 1. */
  readonly clockScale: number;
}
