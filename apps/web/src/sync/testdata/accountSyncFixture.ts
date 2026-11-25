import {
  DEFAULT_RIDER_PROFILE,
  type AccountExport,
  type ProfileState,
  type RideList,
  type RideReceipt,
  type ArchivedRide,
} from "@voltonaut/shared";
import { AccountSync } from "../accountSync.js";
import { outboxKey, type AccountOutbox, type OutboxRow } from "../accountOutbox.js";
import type { AccountSyncLease } from "../accountDataView.js";
import type { PrivateRequestError } from "../apiRoute.js";
import type { SessionView } from "../applicationSession.js";
import { deletionOwnerKey, type DeletionOwner } from "../accountDeletion.js";
import { accountExport } from "../../testdata/accountExport.js";
import { localRide } from "./localRide.js";
import { offlineIdentities, offlineMembership, offlineShop } from "./offlinePorts.js";

export { accountExport };

export const A = "00000000-0000-4000-8000-000000000001";
export const B = "00000000-0000-4000-8000-000000000002";

export class SyncFixture {
  readonly rows = new Map<string, OutboxRow>();
  readonly uploads: string[] = [];
  readonly listeners = new Set<(view: SessionView) => void>();
  active: AccountSyncLease | undefined;
  nowMs = 100_000;
  profile: ProfileState = { status: "missing" };
  profilePending: Promise<ProfileState> | undefined;
  history: RideList = { rides: [], nextCursor: null };
  nextReceipt: (() => Promise<RideReceipt>) | undefined;
  failure: PrivateRequestError | undefined;
  readonly applied: string[] = [];
  readonly purged: DeletionOwner[] = [];
  readonly progressPurged: DeletionOwner[] = [];
  progressPurgeFailure = false;
  readonly deletionConfirmations: string[] = [];
  readonly pendingDeletions = new Map<string, DeletionOwner>();
  purgeFailure = false;
  deletionFailure = false;
  exportFailure = false;
  exportResponse: Promise<AccountExport> | undefined;
  sessionEnded = false;
  sessionClearResult = true;
  archive: readonly ArchivedRide[] = [{ kind: "legacy", recording: localRide }];
  readonly outbox: AccountOutbox = {
    list: (owner) =>
      Promise.resolve([...this.rows.values()].filter((row) => row.userId === owner.userId)),
    claim: (row) => this.write(row),
    update: (row) => this.write(row),
    purgeOwner: (owner) => {
      this.purged.push(owner);

      if (this.purgeFailure) return Promise.reject(new Error("storage"));

      for (const [key, row] of this.rows) {
        if (row.userId === owner.userId && row.apiOrigin === owner.apiOrigin) this.rows.delete(key);
      }

      return Promise.resolve();
    },
  };
  readonly sync = new AccountSync({
    session: {
      authorize: () => this.active,
      subscribe: (listener) => this.subscribe(listener),
      endAfterAccountDeletion: () => {
        this.sessionEnded = true;
        this.logout();

        return this.sessionClearResult;
      },
    },
    outbox: () => Promise.resolve(this.outbox),
    progressOutbox: () =>
      Promise.resolve({
        purgeOwner: (owner) => {
          if (this.progressPurgeFailure) return Promise.reject(new Error("progress storage"));
          this.progressPurged.push(owner);

          return Promise.resolve();
        },
      }),
    deletions: {
      load: () => [...this.pendingDeletions.values()],
      remember: (owner) => {
        this.pendingDeletions.set(deletionOwnerKey(owner), owner);

        return true;
      },
      forget: (owner) => {
        this.pendingDeletions.delete(deletionOwnerKey(owner));

        return true;
      },
    },
    archive: () => Promise.resolve(this.archive),
    profile: {
      saved: () => Promise.resolve(DEFAULT_RIDER_PROFILE),
      apply: (value) => {
        this.applied.push(value.displayName);

        return Promise.resolve();
      },
    },
    nowMs: () => this.nowMs,
  });

  write(row: OutboxRow): Promise<void> {
    this.rows.set(JSON.stringify(outboxKey(row)), row);

    return Promise.resolve();
  }

  subscribe(listener: (view: SessionView) => void): () => void {
    this.listeners.add(listener);
    listener({ kind: "guest", message: "Gast" });

    return () => {
      this.listeners.delete(listener);
    };
  }

  login(userId: string): AccountSyncLease {
    const lease = this.lease(userId);
    this.active = lease;

    for (const listener of this.listeners)
      listener({
        kind: "authenticated",
        persistent: true,
        user: { id: userId, email: `${userId}@example.com`, createdAt: "2026-11-20T00:00:00.000Z" },
      });

    return lease;
  }

  logout(): void {
    this.active = undefined;

    for (const listener of this.listeners) listener({ kind: "guest", message: "Gast" });
  }

  private lease(userId: string): AccountSyncLease {
    const lease: AccountSyncLease = {
      signal: new AbortController().signal,
      userId,
      apiOrigin: "http://localhost:3000",
      generation: this.nowMs++,
      current: () => this.active === lease,
      profile: {
        load: () => this.profilePending ?? Promise.resolve(this.profile),
        save: (value) =>
          Promise.resolve({
            status: "present",
            profile: value,
            updatedAt: "2026-11-20T00:00:00.000Z",
          }),
      },
      rides: this.rides(userId),
      data: this.data(),
      identities: offlineIdentities,
      membership: offlineMembership,
      shop: offlineShop,
    };

    return lease;
  }

  private rides(userId: string): AccountSyncLease["rides"] {
    return {
      history: () => Promise.resolve(this.history),
      detail: () => Promise.reject(new Error("not requested")),
      upload: (ride) => {
        this.uploads.push(userId);

        if (this.failure !== undefined) return Promise.reject(this.failure);

        return (
          this.nextReceipt?.() ??
          Promise.resolve({
            rideId: ride.rideId,
            storage: "stored",
            assessment: { status: "unverified", reason: "legacy_missing_replay" },
          })
        );
      },
    };
  }

  private data(): AccountSyncLease["data"] {
    return {
      exportAccount: () =>
        this.exportFailure
          ? Promise.reject(new Error("export failed"))
          : (this.exportResponse ?? Promise.resolve(accountExport)),
      deleteAccount: (confirmation) => {
        this.deletionConfirmations.push(confirmation);

        return this.deletionFailure
          ? Promise.reject(new Error("delete failed"))
          : Promise.resolve();
      },
    };
  }
}

export function fixture(): SyncFixture {
  return new SyncFixture();
}
