import type { TrainerControl, TrainerAuthority, TrainerControlView } from "@voltonaut/ble";

const HARDWARE_LABEL: Readonly<Record<TrainerControlView["hardware"], string>> = {
  unknown: "Widerstand unbekannt",
  neutralAcknowledged: "Neutralziel bestätigt",
  targetAcknowledged: "Ziel bestätigt",
  stopAcknowledged: "Stop bestätigt, kein Stillstandsnachweis",
};

function readout(label: string) {
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

export function renderTrainerControl(control: TrainerControl, clockScale: number): HTMLElement {
  const section = document.createElement("div");
  section.setAttribute("role", "group");
  section.setAttribute("aria-label", "Rollenschaltung");
  const enable = document.createElement("button");
  const disable = document.createElement("button");
  const status = readout("Rollenschaltung Status");
  const target = readout("Trainer-Ziel");
  const acknowledged = readout("Trainer-ACK");
  const guidance = document.createElement("p");
  enable.textContent = "Rollenschaltung aktivieren";
  disable.textContent = "Rollenschaltung deaktivieren";
  status.output.setAttribute("aria-live", "polite");
  guidance.textContent =
    "Nur ohne andere steuernde App/Uhr aktivieren. Erst neutral, dann beim Treten Engine-Ziel (−5…10 %). Kettenblatt/Cog im Profil prüfen. Trainermasse 83 kg ist unkalibriert; Gefühl unbestätigt. Trennen/Tab schließen garantiert keinen Nullwiderstand.";

  const update = (): void => {
    const view = control.view();
    status.output.textContent = authorityText(view.authority);
    section.dataset["authority"] = view.authority.kind;
    target.output.textContent = `Ziel: ${view.target === undefined ? "—" : `${view.target.gradePct.toFixed(2)} %`}`;
    acknowledged.output.textContent = `ACK: ${view.acknowledged === undefined ? "—" : `${view.acknowledged.gradePct.toFixed(2)} %`} · ${HARDWARE_LABEL[view.hardware]}`;
    enable.disabled = !view.available || view.authority.kind !== "inactive";
    disable.disabled = view.authority.kind !== "active" && view.authority.kind !== "acquiring";
  };

  enable.addEventListener("click", () => {
    void control.enable(clockScale);
  });
  disable.addEventListener("click", () => {
    void control.disable();
  });
  control.subscribe(update);
  update();
  section.append(status.row, target.row, acknowledged.row, enable, disable, guidance);

  return section;
}
