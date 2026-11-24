import { AccountExportSchema, type AccountExport } from "@voltonaut/shared";

export function accountExportFilename(userId: string): string {
  return `voltonaut-account-${userId}.json`;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The shared schema returns a validated mutable copy; this boundary only serializes it.
export function downloadAccountExport(value: Readonly<AccountExport>): void {
  const parsed = AccountExportSchema.parse(value);

  const blob = new Blob([JSON.stringify(parsed, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = accountExportFilename(parsed.account.user.id);
  anchor.click();
  URL.revokeObjectURL(url);
}
