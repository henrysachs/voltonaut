import type { CompletedLocalRide, ProfileState, RideList, User } from "@voltonaut/shared";
import type { ProfileBootstrap } from "../profileBootstrap.js";
import type { ApplicationSession } from "./applicationSession.js";
import type { AccountOutbox, OutboxRow } from "./accountOutbox.js";

type Remote<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed" };

type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };

export type OutboxItem = Immutable<Pick<OutboxRow, "kind" | "state"> & { readonly id: string }>;

type LocalRideItem = Pick<CompletedLocalRide, "rideId" | "startedAt"> & {
  readonly source: "sim" | "ble";
};

export type AccountDataView = Immutable<
  | { readonly kind: "guest" }
  | {
      readonly kind: "account";
      readonly user: User;
      readonly profile: Remote<ProfileState>;
      readonly history: Remote<RideList>;
      readonly outbox: Remote<readonly OutboxItem[]>;
      readonly local: readonly LocalRideItem[];
      readonly message: string;
    }
>;

export interface SyncOptions {
  readonly session: Readonly<Pick<ApplicationSession, "authorize" | "subscribe">>;
  readonly outbox: () => Promise<AccountOutbox>;
  readonly archive: () => Promise<readonly CompletedLocalRide[]>;
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

export function localArchiveView(archive: readonly CompletedLocalRide[]): readonly LocalRideItem[] {
  return archive.map((ride) => ({
    rideId: ride.rideId,
    startedAt: ride.startedAt,
    source: ride.metadata.source,
  }));
}

export function profileApplicationMessage(outcome: "applied" | "pending"): string {
  return outcome === "applied"
    ? "Profil lokal gespeichert. Gilt erst für die nächste Fahrt."
    : "Ein lokales Profil wartet auf Synchronisierung. Serverprofil nicht übernommen.";
}
