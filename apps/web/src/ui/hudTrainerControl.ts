import type { TrainerAuthority, TrainerControlPanel, TrainerControlView } from "@voltonaut/ble";

/** What the HUD shows about trainer resistance; derived only from confirmed control state. */
export type HudResistance =
  | { readonly kind: "hidden" }
  | { readonly kind: "off" }
  | { readonly kind: "starting" }
  | { readonly kind: "active"; readonly acknowledgedGradePct: number | undefined }
  | { readonly kind: "stopping" }
  | { readonly kind: "stopped" }
  | { readonly kind: "lost" }
  | { readonly kind: "failed" };

function fromAuthority(authority: TrainerAuthority, view: TrainerControlView): HudResistance {
  switch (authority.kind) {
    case "inactive":
      return view.hardware === "stopAcknowledged" ? { kind: "stopped" } : { kind: "off" };
    case "acquiring":
      // Neutral and Stop are not confirmed yet: never present this as "off" (AGENTS.md §3.9).
      return authority.step === "stopping" ? { kind: "stopping" } : { kind: "starting" };
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
 * Hidden only while no controllable trainer is connected. A session that ended (lost,
 * failed, or a confirmed stop) reports `available: false` but stays visible: the rider
 * needs to know that resistance control is over until a reconnect.
 */
export function hudResistance(view: TrainerControlView): HudResistance {
  const ended =
    view.authority.kind === "lost" ||
    view.authority.kind === "failed" ||
    (view.authority.kind === "inactive" && view.hardware === "stopAcknowledged");

  return view.available || ended ? fromAuthority(view.authority, view) : { kind: "hidden" };
}

/** Short German state word; this is what the live region announces. */
export function hudResistanceText(state: HudResistance): string {
  switch (state.kind) {
    case "hidden":
      return "";
    case "off":
      return "Widerstand aus · Menü → Geräte";
    case "starting":
      return "Widerstand wird aktiviert …";
    case "active":
      return "Widerstand aktiv";
    case "stopping":
      return "Widerstand wird deaktiviert …";
    case "stopped":
      return "Widerstand aus · Stop bestätigt · neu verbinden";
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

/**
 * The last acknowledged grade, shown next to the state but outside the live region, so a
 * climb does not announce every 0.1 % step. Never a merely requested target (AGENTS.md §9).
 */
export function hudResistanceGrade(state: HudResistance): string {
  if (state.kind !== "active" || state.acknowledgedGradePct === undefined) return "";

  const rounded = Math.round(state.acknowledgedGradePct * 10) / 10;

  return `${(rounded === 0 ? 0 : rounded).toFixed(1)} %`;
}

/** DOM target of the indicator; the element carries the state for styling and tests. */
export interface HudResistanceTarget {
  readonly write: (state: HudResistance["kind"], text: string, grade: string) => void;
}

/** Keeps the indicator in sync with the trainer control, writing only on change. */
export function bindHudResistance(
  control: Readonly<Pick<TrainerControlPanel, "view" | "subscribe">>,
  target: HudResistanceTarget,
): () => void {
  let last = "";

  const update = (): void => {
    const state = hudResistance(control.view());
    const text = hudResistanceText(state);
    const grade = hudResistanceGrade(state);
    const key = `${state.kind}|${text}|${grade}`;

    if (key === last) return;

    last = key;
    target.write(state.kind, text, grade);
  };

  update();

  return control.subscribe(update);
}
