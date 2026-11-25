import type { AccountExport, ArchivedRide } from "@voltonaut/shared";

import {
  historyCursor,
  initialAccountData,
  profileApplicationMessage,
  type AccountDataView,
  type AccountSyncLease,
  type SyncOptions,
} from "./accountDataView.js";
import { type AccountOutbox, type OutboxRead, type OutboxRow } from "./accountOutbox.js";
import { deliverAccountRow } from "./accountDelivery.js";
import type { LeaseBinding } from "./apiRoute.js";
import { applyAccountProfile } from "./accountProfile.js";
import { AccountOutboxRun, type DeliveryMode } from "./accountOutboxRun.js";
import { AccountState } from "./accountState.js";
import {
  deleteAccountData,
  exportAccountData,
  recoverAccountDeletions,
} from "./accountDeletionSync.js";
import {
  claimArchivedRide,
  loadHistory,
  loadIdentities,
  loadLocalArchive,
  loadOutboxRows,
  queueLocalProfile,
} from "./accountSyncLoading.js";

export class AccountSync {
  readonly #options: SyncOptions;
  readonly #state: AccountState<AccountDataView, AccountSyncLease>;
  /** Outbox delivery is its own rule: one run per binding, coalesced follow-ups (ADR-005/018). */
  #run = new AccountOutboxRun();
  #archive: readonly ArchivedRide[] = [];

  constructor(options: SyncOptions) {
    this.#options = options;
    this.#state = new AccountState<AccountDataView, AccountSyncLease>(
      { kind: "guest" },
      {
        enter: (binding) => {
          this.#run = new AccountOutboxRun();
          this.#archive = [];

          return binding.kind === "signedIn" ? initialAccountData(binding.user) : { kind: "guest" };
        },
        start: ({ lease }) => {
          void this.refresh().then(() => (lease.current() ? this.retry("resume") : undefined));
        },
      },
    );
    void recoverAccountDeletions(this.#options, (view) => {
      if (this.#state.view().kind === "guest") this.#state.publish(view);
    });
    this.#state.follow(options.scope);
  }

  view(): AccountDataView {
    return this.#state.view();
  }

  subscribe(listener: (view: AccountDataView) => void): () => void {
    return this.#state.subscribe(listener);
  }

  /** Bound so loaders can take it as their patch callback. */
  private readonly patchAccount = (
    lease: LeaseBinding,
    patch: Partial<Extract<AccountDataView, { readonly kind: "account" }>>,
  ): void => {
    this.#state.update(lease, (view) => (view.kind === "account" ? { ...view, ...patch } : view));
  };

  exportAccount(): Promise<AccountExport | undefined> {
    return exportAccountData(this.#state.lease(), (lease, message) => {
      this.patchAccount(lease, { message });
    });
  }

  deleteAccount(confirmation: string): Promise<boolean> {
    return deleteAccountData(
      this.#state.lease(),
      confirmation,
      this.#options,
      (view) => {
        this.#state.publish(view);
      },
      (lease, message) => {
        this.patchAccount(lease, { message });
      },
    );
  }

  async recoverDeletions(): Promise<void> {
    await recoverAccountDeletions(this.#options, (view) => {
      if (this.#state.view().kind === "guest") this.#state.publish(view);
    });
  }

  async refresh(): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined) return;
    await Promise.all([
      this.loadProfile(lease),
      loadIdentities(lease, this.patchAccount),
      loadHistory(lease, null, this.patchAccount),
      this.loadLocal(lease),
      this.loadRows(lease),
    ]);
  }

  private async loadProfile(lease: AccountSyncLease): Promise<void> {
    try {
      this.patchAccount(lease, { profile: { kind: "ready", value: await lease.profile.load() } });
    } catch {
      this.patchAccount(lease, { profile: { kind: "failed" } });
    }
  }

  async nextHistory(): Promise<void> {
    const lease = this.#state.lease();
    const cursor = historyCursor(this.#state.view());

    if (lease !== undefined && cursor !== null) await loadHistory(lease, cursor, this.patchAccount);
  }

  private async loadLocal(lease: LeaseBinding): Promise<void> {
    const archive = await loadLocalArchive(lease, this.#options.archive, this.patchAccount);

    if (archive !== undefined) this.#archive = archive;
  }

  private loadRows(lease: LeaseBinding): Promise<OutboxRead> {
    return loadOutboxRows(lease, this.#options.outbox, this.patchAccount);
  }

  async claim(rideId: string): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined) return;
    await claimArchivedRide(lease, this.#archive, rideId, this.#options.nowMs, (current, row) => {
      return this.queue(current, row);
    });
  }

  async queueProfile(): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined) return;
    await queueLocalProfile(
      lease,
      this.#options.profile.saved,
      this.#options.nowMs,
      (current, row) => this.queue(current, row),
      this.patchAccount,
    );
  }

  private async queue(lease: LeaseBinding, row: OutboxRow): Promise<void> {
    try {
      const database = await this.#options.outbox();

      if (!lease.current()) return;
      await database.claim(row);
      this.patchAccount(lease, {
        message: "Snapshot dauerhaft diesem Konto zugeordnet. Synchronisierung wird versucht.",
      });
      await this.loadRows(lease);

      if (lease.current()) await this.retry();
    } catch (error) {
      this.patchAccount(lease, {
        message: `Nicht dauerhaft vorgemerkt. ${error instanceof Error ? error.message : "Speicherfehler."}`,
      });
    }
  }

  async applyProfile(): Promise<void> {
    const lease = this.#state.lease();
    const view = this.#state.view();

    if (
      lease === undefined ||
      view.kind !== "account" ||
      view.profile.kind !== "ready" ||
      view.profile.value.status !== "present" ||
      view.outbox.kind !== "ready"
    )
      return;

    try {
      const outcome = await applyAccountProfile({
        lease,
        profile: view.profile.value.profile,
        currentRows: view.outbox.value,
        read: () => this.loadRows(lease),
        apply: this.#options.profile.apply,
      });

      this.patchAccount(lease, {
        message: profileApplicationMessage(outcome),
      });
    } catch {
      this.patchAccount(lease, {
        message: "Serverprofil nicht lokal gespeichert. Bisheriges Profil bleibt maßgeblich.",
      });
    }
  }

  async retry(mode: DeliveryMode = "manual"): Promise<void> {
    const lease = this.#state.lease();
    const run = this.#run;

    if (lease === undefined || run.reauth || !run.claim(mode)) return;

    try {
      const database = await this.#options.outbox();
      const rows = await database.list(lease);
      await this.deliverNext({ lease, run, database, mode }, rows, 0);

      if (lease.current())
        await Promise.all([this.loadProfile(lease), loadHistory(lease, null, this.patchAccount)]);
    } catch {
      this.patchAccount(lease, {
        message: "Speicheränderung nicht bestätigt. Bitte später aktualisieren.",
      });
    } finally {
      const queued = run.release();

      if (queued !== undefined && lease.current()) void this.retry(queued);
    }
  }

  private async deliverNext(
    delivery: Readonly<{
      lease: AccountSyncLease;
      run: Readonly<AccountOutboxRun>;
      database: AccountOutbox;
      mode: DeliveryMode;
    }>,
    rows: readonly OutboxRow[],
    index: number,
  ): Promise<void> {
    const { lease, run, database, mode } = delivery;
    const row = rows[index];

    if (row === undefined || !lease.current() || run.reauth) return;
    const outcome = await deliverAccountRow(lease, database, row, this.#options.nowMs, mode);

    if (!lease.current()) return;

    if (outcome === "reauth") {
      run.rejectSession();
      this.patchAccount(lease, {
        message: "Abmelden, neu anmelden. Speicherstatus ggf. unbestätigt.",
      });
    }

    await this.loadRows(lease);
    await this.deliverNext(delivery, rows, index + 1);
  }
}
