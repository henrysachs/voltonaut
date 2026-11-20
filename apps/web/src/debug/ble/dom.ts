export function element(id: string): HTMLElement {
  const found = document.querySelector(`#${id}`);

  if (found instanceof HTMLElement) {
    return found;
  }

  throw new Error(`Missing #${id}`);
}

export function input(id: string): HTMLInputElement {
  const found = element(id);

  if (found instanceof HTMLInputElement) {
    return found;
  }

  throw new Error(`Expected input #${id}`);
}

export function select(id: string): HTMLSelectElement {
  const found = element(id);

  if (found instanceof HTMLSelectElement) {
    return found;
  }

  throw new Error(`Expected select #${id}`);
}

export function downloadJson(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ble-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function showAdvertisement(frame: AdvertisementFrame): void {
  element("advertisement").textContent = JSON.stringify({
    rssiDbm: frame.rssiDbm,
    manufacturerData: frame.manufacturerData.map((entry) => ({
      companyId: entry.companyId,
      hex: toHex(entry.data),
    })),
    serviceData: frame.serviceData.map((entry) => ({
      service: entry.serviceUuid,
      hex: toHex(entry.data),
    })),
  });
}

import { toHex, type AdvertisementFrame } from "@voltonaut/ble";
