import type { DeviceAdapter, EventBus } from "@voltonaut/shared";
import type { TrainerControl } from "@voltonaut/ble";
import { renderTrainerControl } from "./trainerControl.js";

export interface ConnectSlot {
  readonly label: string;
  readonly adapter: DeviceAdapter;
  readonly select: () => Promise<void>;
  readonly description?: () => string;
  readonly trainer?: { readonly control: TrainerControl; readonly clockScale: number };
}

function renderSlot(slot: ConnectSlot, bus: EventBus): HTMLElement {
  const row = document.createElement("section");
  const heading = document.createElement("h3");
  const status = document.createElement("output");
  const choose = document.createElement("button");
  const retry = document.createElement("button");
  const disconnect = document.createElement("button");
  const description = document.createElement("p");
  description.setAttribute("aria-live", "polite");

  heading.textContent = slot.label;
  status.setAttribute("aria-label", `${slot.label} Status`);
  status.setAttribute("aria-live", "polite");
  choose.textContent = "Gerät wählen";
  retry.textContent = "Erneut verbinden";
  disconnect.textContent = "Trennen";

  const update = (): void => {
    const current = slot.adapter.status();
    status.textContent = current;
    description.textContent = slot.description?.() ?? "";
    retry.hidden = current !== "error";
    disconnect.disabled = current === "disconnected";
    choose.disabled =
      current === "connecting" || current === "handshaking" || current === "reconnecting";
  };

  const connect = (action: () => Promise<void>): void => {
    void action().catch(() => {
      status.textContent = "error";
      retry.hidden = false;
    });
  };

  bindActions(slot, { choose, retry, disconnect }, connect);
  bus.subscribe("device.status", update);
  update();
  row.append(heading, status, description, choose, retry, disconnect);

  if (slot.trainer !== undefined)
    row.append(renderTrainerControl(slot.trainer.control, slot.trainer.clockScale));

  return row;
}

interface ClickTarget {
  readonly addEventListener: (type: "click", listener: () => void) => void;
}

function bindActions(
  slot: ConnectSlot,
  buttons: Readonly<{
    choose: ClickTarget;
    retry: ClickTarget;
    disconnect: ClickTarget;
  }>,
  connect: (action: () => Promise<void>) => void,
): void {
  buttons.choose.addEventListener("click", () => {
    connect(slot.select);
  });
  buttons.retry.addEventListener("click", () => {
    connect(() => slot.adapter.connect());
  });
  buttons.disconnect.addEventListener("click", () => {
    connect(() => slot.adapter.disconnect());
  });
}

export function mountConnectDialog(slots: readonly ConnectSlot[], bus: EventBus): void {
  const open = document.createElement("button");
  const dialog = document.createElement("dialog");
  const title = document.createElement("h2");
  const hint = document.createElement("p");
  const close = document.createElement("button");

  open.textContent = "Geräte verbinden";
  title.textContent = "Bluetooth-Geräte";
  title.id = "connect-title";
  dialog.setAttribute("aria-labelledby", title.id);
  hint.textContent =
    "Zwift, Wahoo-App und Uhr vorher trennen. Nur ein Central steuert sinnvoll; Pulsgurte erlauben oft nur 1–2 Verbindungen.";
  close.textContent = "Schließen";
  open.addEventListener("click", () => {
    dialog.showModal();
  });
  close.addEventListener("click", () => {
    dialog.close();
  });
  dialog.append(title, hint, ...slots.map((slot) => renderSlot(slot, bus)), close);
  document.body.append(open, dialog);
}
