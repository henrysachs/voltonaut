import type { ConnectionStatus, DeviceAdapter, EventBus } from "@voltonaut/shared";
import type { TrainerControlPanel } from "@voltonaut/ble";
import { renderTrainerControl } from "./trainerControl.js";

export interface ConnectSlot {
  readonly label: string;
  readonly adapter: DeviceAdapter;
  readonly select: () => Promise<void>;
  readonly description?: () => string;
  readonly trainer?: TrainerControlPanel;
}

const STATUS_TEXT: Readonly<Record<ConnectionStatus, string>> = {
  disconnected: "Nicht verbunden",
  connecting: "Verbinden …",
  handshaking: "Einrichten …",
  ready: "Verbunden",
  reconnecting: "Neu verbinden …",
  error: "Verbindung fehlgeschlagen",
};

interface SlotElements {
  readonly row: HTMLElement;
  readonly status: HTMLOutputElement;
  readonly rawStatus: HTMLOutputElement;
  readonly choose: HTMLButtonElement;
  readonly retry: HTMLButtonElement;
  readonly disconnect: HTMLButtonElement;
  readonly description: HTMLParagraphElement;
  readonly actions: HTMLElement;
  readonly diagnostics: HTMLDetailsElement;
  readonly diagnosticBody: HTMLElement;
}

function slotElements(slot: ConnectSlot): SlotElements {
  const row = document.createElement("section");
  const heading = document.createElement("h3");
  const status = document.createElement("output");
  const rawStatus = document.createElement("output");
  const choose = document.createElement("button");
  const retry = document.createElement("button");
  const disconnect = document.createElement("button");
  const description = document.createElement("p");
  const actions = document.createElement("div");
  const diagnostics = document.createElement("details");
  const summary = document.createElement("summary");
  const diagnosticBody = document.createElement("div");
  const rawState = document.createElement("p");

  row.setAttribute("class", "device-card");
  heading.textContent = slot.label;
  status.setAttribute("class", "device-card__status");
  status.setAttribute("aria-label", `${slot.label} Verbindung`);
  status.setAttribute("aria-live", "polite");
  rawStatus.setAttribute("aria-label", `${slot.label} Status`);
  choose.textContent = "Gerät wählen";
  retry.textContent = "Erneut verbinden";
  disconnect.textContent = "Trennen";
  description.setAttribute("aria-live", "polite");
  actions.setAttribute("class", "device-card__actions");
  diagnostics.setAttribute("class", "device-card__details");
  summary.textContent = "Technische Details";
  diagnosticBody.setAttribute("class", "device-card__diagnostics");
  rawState.textContent = "Verbindungsstatus: ";
  rawState.append(rawStatus);
  diagnosticBody.append(rawState);
  diagnostics.append(summary, diagnosticBody);
  actions.append(choose, retry, disconnect);
  row.append(heading, status, description, actions, diagnostics);

  return {
    row,
    status,
    rawStatus,
    choose,
    retry,
    disconnect,
    description,
    actions,
    diagnostics,
    diagnosticBody,
  };
}

function renderSlotState(
  slot: Readonly<Pick<ConnectSlot, "description">>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM nodes are mutable render targets; this view only reads their references.
  elements: SlotElements,
  current: ConnectionStatus,
): void {
  elements.status.textContent = STATUS_TEXT[current];
  elements.row.dataset["state"] = current;
  elements.rawStatus.textContent = current;
  elements.description.textContent = slot.description?.() ?? "";
  elements.description.hidden = elements.description.textContent === "";
  elements.retry.hidden = current !== "error";
  elements.disconnect.disabled = current === "disconnected";
  elements.choose.disabled =
    current === "connecting" || current === "handshaking" || current === "reconnecting";
}

function renderSlot(slot: ConnectSlot, bus: EventBus): HTMLElement {
  const elements = slotElements(slot);

  const update = (): void => {
    renderSlotState(slot, elements, slot.adapter.status());
  };

  const connect = (action: () => Promise<void>): void => {
    void action().catch(() => {
      renderSlotState(slot, elements, "error");
    });
  };

  bindActions(slot, elements, connect);
  bus.subscribe("device.status", update);

  if (slot.trainer !== undefined)
    elements.row.append(renderTrainerControl(slot.trainer, elements.diagnosticBody));

  renderSlotState(slot, elements, slot.adapter.status());

  return elements.row;
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
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  const body = document.createElement("div");
  const hint = document.createElement("p");
  const setup = document.createElement("details");
  const setupSummary = document.createElement("summary");
  const setupWarning = document.createElement("p");

  open.textContent = "Geräte verbinden";
  // oxlint-disable-next-line unicorn/prefer-dom-node-dataset -- Keep the navigation hook on the attribute API supported by the existing structural DOM adapter.
  open.setAttribute("data-game-action", "devices");
  dialog.setAttribute("class", "connect-dialog");
  dialog.setAttribute("closedby", "any");
  title.textContent = "Bluetooth-Geräte";
  title.id = "connect-title";
  dialog.setAttribute("aria-labelledby", title.id);
  close.textContent = "Schließen";
  close.setAttribute("autofocus", "");
  header.setAttribute("class", "connect-dialog__header");
  body.setAttribute("class", "connect-dialog__body");
  hint.textContent = "Trainer, Pulsgurt und Play-Griffe verbinden. Die Fahrt läuft weiter.";
  setup.setAttribute("class", "connect-dialog__setup");
  setupSummary.textContent = "Vor dem Verbinden";
  setupWarning.textContent =
    "Zwift, Wahoo-App und Uhr vorher trennen. Nur ein Central steuert sinnvoll; Pulsgurte erlauben oft nur 1–2 Verbindungen.";
  setup.append(setupSummary, setupWarning);
  open.addEventListener("click", () => {
    dialog.showModal();
  });
  close.addEventListener("click", () => {
    dialog.close();
  });
  header.append(title, close);
  body.append(hint, setup, ...slots.map((slot) => renderSlot(slot, bus)));
  dialog.append(header, body);
  document.body.append(open, dialog);
}
