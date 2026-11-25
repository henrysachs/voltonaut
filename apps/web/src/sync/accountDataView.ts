import {
  archivedRideTrack,
  type ArchivedRide,
  type ProfileState,
  type RideList,
  type LinkedIdentity,
  type User,
} from "@voltonaut/shared";
import type { ProfileBootstrap } from "../profileBootstrap.js";
import type { ApplicationSession } from "./applicationSession.js";
import type { AccountOutbox, OutboxRow } from "./accountOutbox.js";
import type { DeletionIntents } from "./accountDeletion.js";

type Remote<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed" };

type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };

export type OutboxItem = Immutable<Pick<OutboxRow, "kind" | "state"> & { readonly id: string }>;

type LocalRideItem = {
  readonly rideId: string;
  readonly startedAt: string;
  readonly source: "sim" | "ble";
  readonly kind: ArchivedRide["kind"];
};

export type AccountDataView = Immutable<
  | { readonly kind: "guest"; readonly message?: string }
  | {
      readonly kind: "account";
      readonly user: User;
      readonly profile: Remote<ProfileState>;
      readonly history: Remote<RideList>;
      readonly outbox: Remote<readonly OutboxItem[]>;
      readonly identities: Remote<readonly LinkedIdentity[]>;
      readonly local: readonly LocalRideItem[];
      readonly message: string;
    }
>;

export interface SyncOptions {
  readonly session: Readonly<
    Pick<ApplicationSession, "authorize" | "subscribe" | "endAfterAccountDeletion">
  >;
  readonly outbox: () => Promise<AccountOutbox>;
  readonly deletions: DeletionIntents;
  readonly archive: () => Promise<readonly ArchivedRide[]>;
  readonly profile: Readonly<Pick<ProfileBootstrap, "saved" | "apply">>;
  readonly nowMs: () => number;
}

export function initialAccountData(user: Readonly<User>): AccountDataView {
  return {
    kind: "account",
    user,
    profile: { kind: "loading" },
    history: { kind: "loading" },
    outbox: { kind: "loading" },
    identities: { kind: "loading" },
    local: [],
    message: "",
  };
}

export function historyCursor(view: AccountDataView): string | null {
  return view.kind === "account" && view.history.kind === "ready"
    ? view.history.value.nextCursor
    : null;
}

export function loadedOutbox(rows: readonly OutboxRow[]): Remote<readonly OutboxItem[]> {
  return {
    kind: "ready",
    value: rows.map((row) => ({
      kind: row.kind,
      id: row.kind === "ride" ? row.payload.rideId : "profile",
      state: row.state,
    })),
  };
}

export function localArchiveView(archive: readonly ArchivedRide[]): readonly LocalRideItem[] {
  return archive.map((ride) => {
    const track = archivedRideTrack(ride);

    return {
      rideId: track.rideId,
      startedAt: track.startedAt,
      source: track.metadata.source,
      kind: ride.kind,
    };
  });
}

export function profileApplicationMessage(outcome: "applied" | "pending"): string {
  return outcome === "applied"
    ? "Profil lokal gespeichert. Gilt erst für die nächste Fahrt."
    : "Ein lokales Profil wartet auf Synchronisierung. Serverprofil nicht übernommen.";
}
