import type { TrainerAuthority, TrainerControlPanel, TrainerControlView } from "@voltonaut/ble";

/** What the HUD shows about trainer resistance; derived only from confirmed control state. */
export type HudResistance =
  | { readonly kind: "hidden" }
  | { readonly kind: "off" }
  | { readonly kind: "starting" }
  | { readonly kind: "active"; readonly acknowledgedGradePct: number | undefined }
  | { readonly kind: "lost" }
  | { readonly kind: "failed" };

function fromAuthority(authority: TrainerAuthority, view: TrainerControlView): HudResistance {
  switch (authority.kind) {
    case "inactive":
      return { kind: "off" };
    case "acquiring":
      return authority.step === "stopping" ? { kind: "off" } : { kind: "starting" };
    case "active":
      return {
        kind: "active",
        acknowledgedGradePct:
          view.hardware === "targetAcknowledged" || view.hardware === "neutralAcknowledged"
            ? view.acknowledged?.gradePct
            : undefined,
      };
    case "lost":
      return { kind: "lost" };
    case "failed":
      return { kind: "failed" };
    default: {
      const exhaustive: never = authority;

      return exhaustive;
    }
  }
}

/**
 * Hidden while no controllable trainer is connected. A lost or failed session also reports
 * `available: false`, but must stay visible: that is the warning the rider needs.
 */
export function hudResistance(view: TrainerControlView): HudResistance {
  if (view.authority.kind === "lost" || view.authority.kind === "failed") {
    return fromAuthority(view.authority, view);
  }

  return view.available ? fromAuthority(view.authority, view) : { kind: "hidden" };
}

/**
 * Short German HUD text. "Aktiv" only after the trainer acknowledged control; the grade is
 * the last acknowledged target, never a merely requested one (AGENTS.md §9).
 */
export function hudResistanceText(state: HudResistance): string {
  switch (state.kind) {
    case "hidden":
      return "";
    case "off":
      return "Widerstand aus · Menü → Geräte";
    case "starting":
      return "Widerstand wird aktiviert …";
    case "active":
      return state.acknowledgedGradePct === undefined
        ? "Widerstand aktiv"
        : `Widerstand aktiv · ${state.acknowledgedGradePct.toFixed(1)} %`;
    case "lost":
      return "Widerstand verloren · neu verbinden";
    case "failed":
      return "Widerstand fehlgeschlagen · Geräte prüfen";
    default: {
      const exhaustive: never = state;

      return exhaustive;
    }
  }
}

/** DOM target of the indicator; the element carries the state for styling and tests. */
export interface HudResistanceTarget {
  readonly write: (text: string, state: HudResistance["kind"]) => void;
}

/** Keeps the indicator in sync with the trainer control; returns the unsubscribe. */
export function bindHudResistance(
  control: Readonly<Pick<TrainerControlPanel, "view" | "subscribe">>,
  target: HudResistanceTarget,
): () => void {
  const update = (): void => {
    const state = hudResistance(control.view());

    target.write(hudResistanceText(state), state.kind);
  };

  update();

  return control.subscribe(update);
}
