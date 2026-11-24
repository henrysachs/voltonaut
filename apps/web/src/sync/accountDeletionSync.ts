import type { AccountExport } from "@voltonaut/shared";
import type { AccountDataView } from "./accountDataView.js";
import type { AccountOutbox } from "./accountOutbox.js";
import type { DeletionIntents, DeletionOwner } from "./accountDeletion.js";
import type { AccountLease } from "./privateAuthTransport.js";
import type { ApplicationSession } from "./applicationSession.js";

interface DeletionSyncOptions {
  readonly session: Readonly<Pick<ApplicationSession, "endAfterAccountDeletion">>;
  readonly outbox: () => Promise<AccountOutbox>;
  readonly deletions: DeletionIntents;
}

type PatchAccount = (lease: AccountLease, message: string) => void;

type PublishView = (view: AccountDataView) => void;

export async function exportAccountData(
  lease: AccountLease | undefined,
  patch: PatchAccount,
): Promise<AccountExport | undefined> {
  if (lease === undefined) return undefined;

  try {
    const value = await lease.exportAccount();

    return lease.current() ? value : undefined;
  } catch {
    patch(
      lease,
      "Datenexport nicht bestätigt. Keine Datei erzeugt; Verbindung und Anmeldung prüfen.",
    );

    return undefined;
  }
}

export async function deleteAccountData(
  lease: AccountLease | undefined,
  confirmation: string,
  options: DeletionSyncOptions,
  publish: PublishView,
  patch: PatchAccount,
): Promise<boolean> {
  if (lease === undefined) return false;

  try {
    await lease.deleteAccount(confirmation);
  } catch {
    patch(
      lease,
      "Kontolöschung nicht bestätigt. Lokale Daten bleiben unverändert; die Session kann serverseitig bereits ungültig sein.",
    );

    return false;
  }

  const owner: DeletionOwner = { apiOrigin: lease.apiOrigin, userId: lease.userId };
  options.session.endAfterAccountDeletion();
  const remembered = options.deletions.remember(owner);
  const cleaned = await cleanupOwner(owner, options);

  let message =
    "Konto gelöscht. Lokale Session und zugeordnete Outbox-Einträge wurden entfernt. Lokale Fahrten und Gastprofil bleiben erhalten.";

  if (!cleaned)
    message = remembered
      ? "Konto gelöscht. Lokale Bereinigung noch nicht bestätigt und für einen späteren Versuch vermerkt. Lokale Fahrten und Gastprofil bleiben erhalten."
      : "Konto gelöscht. Lokale Bereinigung ist nicht bestätigt und konnte nicht dauerhaft vermerkt werden; Browserdaten prüfen.";
  publish({ kind: "guest", message });

  return true;
}

export async function recoverAccountDeletions(
  options: DeletionSyncOptions,
  publish: PublishView,
): Promise<void> {
  const pending = options.deletions.load();

  const results = await Promise.all(
    pending.map(async (owner) => ({ cleaned: await cleanupOwner(owner, options) })),
  );

  if (results.some((result: Readonly<{ readonly cleaned: boolean }>) => !result.cleaned))
    publish({
      kind: "guest",
      message:
        "Lokale Bereinigung gelöschter Konten noch nicht bestätigt. Für einen späteren Versuch vermerkt; Browserdaten prüfen.",
    });
}

async function cleanupOwner(
  owner: Readonly<DeletionOwner>,
  options: Readonly<DeletionSyncOptions>,
): Promise<boolean> {
  try {
    await (await options.outbox()).purgeOwner(owner);
    options.deletions.forget(owner);

    return true;
  } catch {
    return false;
  }
}
