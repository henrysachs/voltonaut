import { element, input, showAdvertisement } from "./dom.js";
import type { LabDevices } from "./devices.js";
import type { LabDevice } from "./device.js";

export function deviceLabel(device: Readonly<LabDevice>): string {
  return `${device.number} · ${device.name} · ${device.id}`;
}

export function renderDevices(devices: Readonly<LabDevices>): void {
  const root = element("devices");
  root.replaceChildren();

  for (const device of devices.entries) {
    const card = document.createElement("article");
    card.setAttribute("aria-label", deviceLabel(device));
    card.className = `device-card ${device.state.kind}`;
    const choose = document.createElement("button");
    choose.textContent = deviceLabel(device);
    choose.setAttribute("aria-pressed", String(devices.selected === device));
    choose.addEventListener("click", () => {
      devices.select(device);
    });
    const status = document.createElement("output");
    status.textContent = device.state.kind;
    const detail = document.createElement("p");
    detail.textContent =
      device.state.kind === "error"
        ? device.state.message
        : "Mitschnitt bleibt beim Ansichtswechsel erhalten.";
    card.append(choose, status, detail);
    root.append(card);
  }

  const target = devices.selected;

  if (target !== undefined) {
    element("selected-device").textContent = `Details · ${deviceLabel(target)}`;
    element("status").textContent =
      target.state.kind === "error" ? target.state.message : target.state.kind;
    element("advertisement").textContent = "Advertising noch nicht verfügbar";

    if (target.advertisement !== undefined) {
      showAdvertisement(target.advertisement);
    }
  }
}

export function restoreMetadata(device: Readonly<LabDevice>): void {
  input("firmware").value = device.firmware;
  input("notes").value = device.notes;
}
