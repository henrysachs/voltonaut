import { afterEach, expect, it, vi } from "vitest";
import { accountExport } from "../testdata/accountExport.js";
import { accountExportFilename, downloadAccountExport } from "./accountExportDownload.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("attaches the download and revokes its object URL after the browser starts", () => {
  vi.useFakeTimers();

  const anchor = {
    href: "",
    download: "",
    click: vi.fn<() => void>(),
    remove: vi.fn<() => void>(),
  };

  const body = { append: vi.fn<(value: Readonly<{ href: string }>) => void>() };
  const createObjectURL = vi.fn<(blob: Readonly<Blob>) => string>(() => "blob:account-export");
  const revokeObjectURL = vi.fn<(url: string) => void>();
  vi.stubGlobal("document", { body, createElement: () => anchor });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

  downloadAccountExport(accountExport);

  expect(body.append).toHaveBeenCalledWith(anchor);
  expect(anchor.download).toBe(accountExportFilename(accountExport.account.user.id));
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:account-export");
});
