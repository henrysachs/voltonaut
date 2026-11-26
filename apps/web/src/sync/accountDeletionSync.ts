import type { AccountDeletionResponse, AccountExport } from "@voltonaut/shared";
import type { AccountDataView } from "./accountDataView.js";
import type { AccountOutbox } from "./accountOutbox.js";
import type { DeletionIntents, DeletionOwner } from "./accountDeletion.js";
import type { AccountDataPort } from "./accountPorts.js";
import type { LeaseBinding } from "./apiRoute.js";
import type { ApplicationSession } from "./applicationSession.js";
import type { ProgressOutbox } from "./progressOutbox.js";

interface DeletionSyncOptions {
  readonly session: Readonly<Pick<ApplicationSession, "endAfterAccountDeletion">>;
  readonly outbox: () => Promise<AccountOutbox>;
  readonly progressOutbox: () => Promise<Pick<ProgressOutbox, "purgeOwner">>;
  readonly deletions: DeletionIntents;
}

/** What the deletion did at Strava (issue #140); empty when no connection existed. */
const STRAVA_REVOCATION_TEXT: Readonly<
  Record<AccountDeletionResponse["stravaRevocation"], string>
> = {
  revoked: "Strava-Zugriff widerrufen.",
  not_connected: "",
  failed:
    "Strava-Zugriff konnte nicht widerrufen werden: Voltonaut bitte in den Strava-Einstellungen unter „Meine Apps“ entfernen.",
};

type DataLease = LeaseBinding & { readonly data: AccountDataPort };

type PatchAccount = (lease: LeaseBinding, message: string) => void;

type PublishView = (view: AccountDataView) => void;

export async function exportAccountData(
  lease: DataLease | undefined,
  patch: PatchAccount,
): Promise<AccountExport | undefined> {
  if (lease === undefined) return undefined;

  try {
    const value = await lease.data.exportAccount();

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
  lease: DataLease | undefined,
  confirmation: string,
  options: DeletionSyncOptions,
  publish: PublishView,
  patch: PatchAccount,
): Promise<boolean> {
  if (lease === undefined) return false;

  let deletion: AccountDeletionResponse;

  try {
    deletion = await lease.data.deleteAccount(confirmation);
  } catch {
    patch(
      lease,
      "Kontolöschung nicht bestätigt. Lokale Daten bleiben unverändert; die Session kann serverseitig bereits ungültig sein.",
    );

    return false;
  }

  const owner: DeletionOwner = { apiOrigin: lease.apiOrigin, userId: lease.userId };
  const sessionCleared = options.session.endAfterAccountDeletion();
  const remembered = options.deletions.remember(owner);
  const cleaned = await cleanupOwner(owner, options);
  const messages: string[] = [];

  const strava = STRAVA_REVOCATION_TEXT[deletion.stravaRevocation];

  if (strava !== "") messages.push(strava);

  if (sessionCleared) messages.push("Lokale Session entfernt.");
  else messages.push("Lokale Session konnte nicht entfernt werden; Browserdaten prüfen.");

  if (cleaned) messages.push("Zugeordnete Outbox-Einträge entfernt.");
  else
    messages.push(
      remembered
        ? "Lokale Bereinigung noch nicht bestätigt und für einen späteren Versuch vermerkt."
        : "Lokale Bereinigung ist nicht bestätigt und konnte nicht dauerhaft vermerkt werden; Browserdaten prüfen.",
    );
  publish({
    kind: "guest",
    message: `Konto gelöscht. ${messages.join(" ")} Lokale Fahrten und Gastprofil bleiben erhalten.`,
  });

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
  const results = await Promise.allSettled([
    options.outbox().then((outbox) => outbox.purgeOwner(owner)),
    options.progressOutbox().then((outbox) => outbox.purgeOwner(owner)),
  ]);

  if (results.some((result: Readonly<PromiseSettledResult<void>>) => result.status === "rejected"))
    return false;

  options.deletions.forget(owner);

  return true;
}
