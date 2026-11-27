import { afterEach, expect, it, vi } from "vitest";

import { downloadPreviewPng, PREVIEW_PNG_FILENAME } from "./previewDownload.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("downloads a PNG under its static filename and revokes the object URL", () => {
  vi.useFakeTimers();

  const anchor = {
    href: "",
    download: "",
    click: vi.fn<() => void>(),
    remove: vi.fn<() => void>(),
  };

  const body = { append: vi.fn<(value: Readonly<{ href: string }>) => void>() };
  const createObjectURL = vi.fn<(blob: Readonly<Blob>) => string>(() => "blob:garage-preview");
  const revokeObjectURL = vi.fn<(url: string) => void>();
  vi.stubGlobal("document", { body, createElement: () => anchor });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const blob = new Blob(["png"], { type: "image/png" });

  downloadPreviewPng(blob);

  expect(createObjectURL).toHaveBeenCalledWith(blob);
  expect(body.append).toHaveBeenCalledWith(anchor);
  expect(anchor.href).toBe("blob:garage-preview");
  expect(anchor.download).toBe(PREVIEW_PNG_FILENAME);
  expect(anchor.download).toBe("voltonaut-garage.png");
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:garage-preview");
});

it("rejects a non-PNG blob before creating an object URL", () => {
  const createObjectURL = vi.fn<(blob: Readonly<Blob>) => string>(() => "blob:unused");
  vi.stubGlobal("URL", { createObjectURL });

  expect(() => {
    downloadPreviewPng(new Blob(["json"], { type: "application/json" }));
  }).toThrow("Preview download must be a PNG");
  expect(createObjectURL).not.toHaveBeenCalled();
});
