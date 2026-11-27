import type { LabDeviceKind } from "@voltonaut/ble";
import { element, input, showAdvertisement } from "./dom.js";
import type { LabDevices } from "./devices.js";
import type { LabDevice } from "./device.js";
import { countLog } from "./logView.js";

export function deviceLabel(device: Readonly<LabDevice>): string {
  return `${device.number} · ${device.name} · ${device.id}`;
}

function kindLabel(kind: LabDeviceKind): string {
  switch (kind.kind) {
    case "trainer":
      return kind.ftmsControl ? "Trainer · FTMS steuerbar" : "Trainer · nur Messwerte";
    case "controller":
      return kind.family === "clickV2" ? "Zwift Click v2" : "Zwift Play";
    case "heartRate":
      return "Pulsgurt";
    case "unknown":
      return "Unbekanntes Gerät";
    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
}

function statusText(device: Readonly<LabDevice>): string {
  switch (device.state.kind) {
    case "connecting":
      return "Verbinde …";
    case "ready":
      return "Verbunden · zeichnet auf";
    case "disconnected":
      return "Getrennt · Mitschnitt bleibt erhalten";
    case "error":
      return device.state.message;
    default: {
      const exhaustive: never = device.state;

      return exhaustive;
    }
  }
}

export interface DeviceCardActions {
  readonly exportDevice: (device: Readonly<LabDevice>) => void;
}

interface CardElements {
  readonly article: HTMLElement;
  readonly choose: HTMLElement;
  readonly kind: HTMLElement;
  readonly status: HTMLElement;
  readonly counts: HTMLElement;
}

function createCard(
  devices: Readonly<LabDevices>,
  device: Readonly<LabDevice>,
  actions: DeviceCardActions,
): CardElements {
  const article = document.createElement("article");
  article.setAttribute("aria-label", deviceLabel(device));

  const choose = document.createElement("button");
  choose.className = "device-choose";
  choose.textContent = deviceLabel(device);
  choose.addEventListener("click", () => {
    devices.select(device);
  });

  const kind = document.createElement("p");
  kind.className = "device-kind";

  const status = document.createElement("output");

  const counts = document.createElement("p");
  counts.className = "device-counts";

  const exportButton = document.createElement("button");
  exportButton.textContent = "Export";
  exportButton.setAttribute("aria-label", `Export ${deviceLabel(device)}`);
  exportButton.addEventListener("click", () => {
    actions.exportDevice(device);
  });

  article.append(choose, kind, status, counts, exportButton);

  return { article, choose, kind, status, counts };
}

function updateCard(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM nodes are mutable render targets; the card is updated in place so focus survives.
  cardElements: CardElements,
  device: Readonly<LabDevice>,
  selected: boolean,
): void {
  const counts = countLog(device.session.fixture(device.firmware, device.notes).log);
  cardElements.article.className = `device-card ${device.state.kind}`;
  cardElements.choose.setAttribute("aria-pressed", String(selected));
  cardElements.kind.textContent =
    device.state.kind === "connecting" ? "Gerät wird erkannt …" : kindLabel(device.kind);
  cardElements.status.textContent = statusText(device);
  cardElements.counts.textContent = `${counts.received} empfangen · ${counts.sent} gesendet · ${counts.markers} Marker${device.firmware === "" ? "" : ` · Firmware ${device.firmware}`}`;
}

/**
 * Device cards are created once per device and then updated in place: replacing them on
 * every advertisement or capture change would steal keyboard focus. The lab never removes
 * a device, so cards are only ever appended.
 */
export function createDeviceList(
  devices: Readonly<LabDevices>,
  actions: DeviceCardActions,
): () => void {
  const cards = new Map<Readonly<LabDevice>, CardElements>();

  return () => {
    const root = element("devices");

    if (cards.size === 0 && devices.entries.length > 0) root.replaceChildren();

    for (const device of devices.entries) {
      const existing = cards.get(device);
      const cardElements = existing ?? createCard(devices, device, actions);

      if (existing === undefined) {
        cards.set(device, cardElements);
        root.append(cardElements.article);
      }

      updateCard(cardElements, device, devices.selected === device);
    }

    const target = devices.selected;

    if (target !== undefined) {
      element("selected-device").textContent = `Details · ${deviceLabel(target)}`;
      element("status").textContent = statusText(target);
      element("status").dataset["state"] = target.state.kind;
      element("advertisement").textContent = "Advertising noch nicht verfügbar";

      if (target.advertisement !== undefined) {
        showAdvertisement(target.advertisement);
      }
    }
  };
}

export function restoreMetadata(device: Readonly<LabDevice>): void {
  input("firmware").value = device.firmware;
  input("notes").value = device.notes;
}
