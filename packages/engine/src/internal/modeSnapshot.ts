import type { FunItemId, Seconds } from "@voltonaut/shared";

import type { ModeState } from "./state.js";

/** Read-only view of the ride mode and its state (ADR-028). */
export type ModeSnapshot =
  | { readonly kind: "normal" }
  | {
      readonly kind: "fun";
      readonly heldItem: FunItemId | undefined;
      readonly activeItem: FunItemId | undefined;
      readonly activeRemainingS: Seconds;
    };

const NORMAL_MODE_SNAPSHOT: ModeSnapshot = Object.freeze({ kind: "normal" });

/** Frozen copy of the mode slice for the snapshot. */
export function modeSnapshot(mode: Readonly<ModeState>): ModeSnapshot {
  switch (mode.kind) {
    case "normal":
      return NORMAL_MODE_SNAPSHOT;
    case "fun":
      return Object.freeze({
        kind: "fun",
        heldItem: mode.heldItem,
        activeItem: mode.activeItem,
        activeRemainingS: mode.activeRemainingS,
      });
    default: {
      const exhaustive: never = mode;

      return exhaustive;
    }
  }
}
