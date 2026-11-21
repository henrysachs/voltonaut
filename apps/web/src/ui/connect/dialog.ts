import type { DeviceAdapter, EventBus } from "@voltonaut/shared";

export interface ConnectSlot {
  readonly label: string;
  readonly adapter: DeviceAdapter;
  readonly select: () => Promise<void>;
  readonly description?: () => string;
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

  choose.addEventListener("click", () => {
    connect(slot.select);
  });
  retry.addEventListener("click", () => {
    connect(() => slot.adapter.connect());
  });
  disconnect.addEventListener("click", () => {
    connect(() => slot.adapter.disconnect());
  });
  bus.subscribe("device.status", update);
  update();
  row.append(heading, status, description, choose, retry, disconnect);

  return row;
}

export function mountConnectDialog(slots: readonly ConnectSlot[], bus: EventBus): void {
  const open = document.createElement("button");
  const dialog = document.createElement("dialog");
  const title = document.createElement("h2");
  const hint = document.createElement("p");
  const close = document.createElement("button");

  open.textContent = "Geräte verbinden";
  // oxlint-disable-next-line unicorn/prefer-dom-node-dataset -- Keep the navigation hook on the attribute API supported by the existing structural DOM adapter.
  open.setAttribute("data-game-action", "devices");
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
