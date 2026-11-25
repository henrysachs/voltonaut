import {
  archivedRideTrack,
  RideUploadSchema,
  type ArchivedRide,
  type RiderProfile,
} from "@voltonaut/shared";
import { localArchiveView, loadedOutbox, type AccountDataView } from "./accountDataView.js";
import {
  newOutboxRow,
  type AccountOutbox,
  type OutboxRead,
  type OutboxRow,
} from "./accountOutbox.js";
import type { RidePort } from "./accountPorts.js";
import type { IdentityPort } from "./identityPort.js";
import type { LeaseBinding } from "./apiRoute.js";

type AccountState = Extract<AccountDataView, { readonly kind: "account" }>;

type PatchAccount = (lease: LeaseBinding, patch: Partial<AccountState>) => void;

type QueueRow = (current: LeaseBinding, row: OutboxRow) => Promise<void>;

export async function claimArchivedRide(
  lease: LeaseBinding,
  archive: readonly ArchivedRide[],
  rideId: string,
  nowMs: () => number,
  queue: QueueRow,
): Promise<void> {
  const ride = archive.find((item) => archivedRideTrack(item).rideId === rideId);

  if (ride === undefined || ride.kind === "local_only") return;
  await queue(lease, newOutboxRow(lease, RideUploadSchema.parse(ride.recording), nowMs()));
}

export async function queueLocalProfile(
  lease: LeaseBinding,
  saved: () => Promise<RiderProfile | undefined>,
  nowMs: () => number,
  queue: QueueRow,
  patch: PatchAccount,
): Promise<void> {
  try {
    const profile = await saved();

    if (!lease.current()) return;

    if (profile === undefined) {
      patch(lease, {
        message: "Noch kein lokal gespeichertes Profil. Zuerst das Profilformular speichern.",
      });

      return;
    }

    await queue(lease, newOutboxRow(lease, profile, nowMs()));
  } catch {
    patch(lease, { message: "Lokales Profil nicht lesbar. Nicht vorgemerkt." });
  }
}

export async function loadIdentities(
  lease: LeaseBinding & { readonly identities: Pick<IdentityPort, "list"> },
  patch: PatchAccount,
): Promise<void> {
  try {
    const response = await lease.identities.list();
    patch(lease, { identities: { kind: "ready", value: response.identities } });
  } catch {
    patch(lease, { identities: { kind: "failed" } });
  }
}

export async function loadHistory(
  lease: LeaseBinding & { readonly rides: Pick<RidePort, "history"> },
  cursor: string | null,
  patch: PatchAccount,
): Promise<void> {
  try {
    const value = await lease.rides.history(cursor);
    patch(lease, { history: { kind: "ready", value } });
  } catch {
    patch(lease, { history: { kind: "failed" } });
  }
}

export async function loadLocalArchive(
  lease: LeaseBinding,
  archive: () => Promise<readonly ArchivedRide[]>,
  patch: PatchAccount,
): Promise<readonly ArchivedRide[] | undefined> {
  try {
    const value = await archive();

    if (!lease.current()) return undefined;
    patch(lease, { local: localArchiveView(value) });

    return value;
  } catch {
    patch(lease, {
      message: "Lokales Archiv nicht verfügbar. Aufnahme und TCX bleiben unabhängig.",
    });

    return undefined;
  }
}

export async function loadOutboxRows(
  lease: LeaseBinding,
  outbox: () => Promise<AccountOutbox>,
  patch: PatchAccount,
): Promise<OutboxRead> {
  patch(lease, { outbox: { kind: "loading" } });

  try {
    const rows = await (await outbox()).list(lease);
    patch(lease, { outbox: loadedOutbox(rows) });

    return { kind: "ready", rows };
  } catch {
    patch(lease, {
      outbox: { kind: "failed" },
      message: "Kontowarteschlange nicht verfügbar. Neue Aufträge sind nicht dauerhaft vorgemerkt.",
    });

    return { kind: "failed" };
  }
}
