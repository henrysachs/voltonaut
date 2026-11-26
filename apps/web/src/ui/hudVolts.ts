import type { ProgressLiveStatus, ProgressLiveView } from "../sync/progressLive.js";

const STATUS_TEXT: Readonly<Record<ProgressLiveStatus, string>> = {
  sim: "Sim – keine Serverbuchung",
  guest: "Gast – keine Serverbuchung",
  off: "Automatischer Fortschritt aus – keine Serverbuchung",
  pending: "ausstehend",
  syncing: "wird synchronisiert",
  offline: "offline – wartet lokal",
  failed: "nicht synchronisiert – Daten bleiben lokal",
  confirmed: "vom Server bestätigt",
};

/** HUD line for the running ride (spec E6-11 AK4); never shows a confirmed value without receipt. */
export function hudVoltsText(view: Readonly<ProgressLiveView>): string {
  if (view.previewVolts === null) return "";
  const confirmed = view.confirmedVolts === null ? "–" : `${view.confirmedVolts}`;
  const withheld = view.withheldVolts > 0 ? ` · ${view.withheldVolts} über Tageslimit` : "";

  return `⚡ ${view.previewVolts} vorläufig · ${confirmed} bestätigt · ${STATUS_TEXT[view.status]}${withheld}`;
}

export function mountHudVolts(
  live: Readonly<{ subscribe: (listener: (view: ProgressLiveView) => void) => () => void }>,
): void {
  const element = document.querySelector<HTMLElement>("#hud-volts");

  if (element === null) return;
  live.subscribe((view) => {
    element.textContent = hudVoltsText(view);
    element.dataset["status"] = view.status;
    element.dataset["previewVolts"] = view.previewVolts === null ? "" : String(view.previewVolts);
    element.dataset["confirmedVolts"] =
      view.confirmedVolts === null ? "" : String(view.confirmedVolts);
  });
}
