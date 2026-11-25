import type { TrainerControlPanel, TrainerAuthority, TrainerControlView } from "@voltonaut/ble";

const HARDWARE_LABEL: Readonly<Record<TrainerControlView["hardware"], string>> = {
  unknown: "Widerstand unbekannt",
  neutralAcknowledged: "Neutralziel bestätigt",
  targetAcknowledged: "Ziel bestätigt",
  stopAcknowledged: "Stop bestätigt, kein Stillstandsnachweis",
};

interface Readout {
  readonly row: HTMLParagraphElement;
  readonly output: HTMLOutputElement;
}

interface ControlElements {
  readonly section: HTMLElement;
  readonly enable: HTMLButtonElement;
  readonly disable: HTMLButtonElement;
  readonly status: Readout;
  readonly reason: HTMLParagraphElement;
  readonly rawStatus: Readout;
  readonly target: Readout;
  readonly acknowledged: Readout;
}

function readout(label: string): Readout {
  const row = document.createElement("p");
  const output = document.createElement("output");
  output.setAttribute("aria-label", label);
  row.append(output);

  return { row, output };
}

function authorityText(authority: TrainerAuthority): string {
  switch (authority.kind) {
    case "inactive":
    case "failed":
    case "lost":
      return authority.reason;
    case "acquiring":
      return `Freigabe läuft: ${authority.step}.`;
    case "active":
      return "Aktiv · Trainersteuerung freigegeben.";
    default: {
      const exhaustive: never = authority;

      return exhaustive;
    }
  }
}

function authoritySummary(authority: TrainerAuthority): string {
  switch (authority.kind) {
    case "inactive":
      return "Aus";
    case "acquiring":
      return authority.step === "stopping" ? "Wird gestoppt …" : "Wird aktiviert …";
    case "active":
      return "Aktiv";
    case "lost":
      return "Verbindung verloren";
    case "failed":
      return "Aktivierung fehlgeschlagen";
    default: {
      const exhaustive: never = authority;

      return exhaustive;
    }
  }
}

function controlElements(): ControlElements {
  const section = document.createElement("div");
  const heading = document.createElement("h4");
  const enable = document.createElement("button");
  const disable = document.createElement("button");
  const status = readout("Rollenschaltung Übersicht");
  const reason = document.createElement("p");
  const guidance = document.createElement("p");

  section.setAttribute("role", "group");
  section.setAttribute("aria-label", "Rollenschaltung");
  heading.textContent = "Widerstand";
  enable.textContent = "Widerstand aktivieren";
  disable.textContent = "Widerstand deaktivieren";
  status.output.setAttribute("aria-live", "polite");
  reason.setAttribute("aria-live", "polite");
  guidance.textContent =
    "Nur ohne andere steuernde App oder Uhr aktivieren. Schließen oder Trennen garantiert keinen Nullwiderstand.";
  section.append(heading, status.row, reason, guidance, enable, disable);

  return {
    section,
    enable,
    disable,
    status,
    reason,
    rawStatus: readout("Rollenschaltung Status"),
    target: readout("Trainer-Ziel"),
    acknowledged: readout("Trainer-ACK"),
  };
}

function updateControl(
  control: Readonly<Pick<TrainerControlPanel, "view">>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM nodes are mutable render targets; this view only reads their references.
  elements: ControlElements,
): void {
  const view = control.view();
  elements.status.output.textContent = authoritySummary(view.authority);
  elements.reason.textContent =
    view.authority.kind === "inactive" ||
    view.authority.kind === "lost" ||
    view.authority.kind === "failed"
      ? view.authority.reason
      : "";
  elements.reason.hidden = elements.reason.textContent === "";
  elements.section.dataset["authority"] = view.authority.kind;
  elements.rawStatus.output.textContent = authorityText(view.authority);
  elements.target.output.textContent = `Ziel: ${view.target === undefined ? "—" : `${view.target.gradePct.toFixed(2)} %`}`;
  elements.acknowledged.output.textContent = `ACK: ${view.acknowledged === undefined ? "—" : `${view.acknowledged.gradePct.toFixed(2)} %`} · ${HARDWARE_LABEL[view.hardware]}`;
  elements.enable.disabled = !view.available || view.authority.kind !== "inactive";
  elements.disable.hidden = view.authority.kind !== "active" && view.authority.kind !== "acquiring";
  elements.disable.disabled = elements.disable.hidden;
}

export function renderTrainerControl(
  control: TrainerControlPanel,
  diagnostics: Readonly<Pick<HTMLElement, "append">>,
): HTMLElement {
  const elements = controlElements();
  const technicalGuidance = document.createElement("p");
  technicalGuidance.textContent =
    "Erst neutral, dann beim Treten Engine-Ziel (−5…10 %). Kettenblatt/Cog im Profil prüfen. Trainermasse 83 kg ist unkalibriert; Gefühl unbestätigt.";
  diagnostics.append(
    elements.rawStatus.row,
    elements.target.row,
    elements.acknowledged.row,
    technicalGuidance,
  );
  elements.enable.addEventListener("click", () => {
    void control.enable();
  });
  elements.disable.addEventListener("click", () => {
    void control.disable();
  });
  control.subscribe(() => {
    updateControl(control, elements);
  });
  updateControl(control, elements);

  return elements.section;
}
