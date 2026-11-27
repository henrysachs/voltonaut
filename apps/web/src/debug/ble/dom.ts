import { describeAdvertisement, type AdvertisementFrame } from "@voltonaut/ble";

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

/** File-system safe part of a download name. */
export function fileSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, "") || "geraet"
  );
}

export function downloadJson(json: string, baseName: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${baseName}-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function showAdvertisement(frame: AdvertisementFrame): void {
  element("advertisement").textContent = describeAdvertisement(frame);
}
