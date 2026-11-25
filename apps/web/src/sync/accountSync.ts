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
import { AccountAdministration } from "./accountAdministration.js";
import { GarageAccount } from "./garageAccount.js";
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
  readonly administration = new AccountAdministration();
  readonly garage = new GarageAccount();
  readonly #options: SyncOptions;
  readonly #listeners = new Set<(view: AccountDataView) => void>();
  readonly #sending = new Set<number>();
  readonly #pending = new Map<number, "manual" | "resume">();
  #view: AccountDataView = { kind: "guest" };
  #lease: AccountSyncLease | undefined;
  #archive: readonly ArchivedRide[] = [];
  #reauth = false;

  constructor(options: SyncOptions) {
    this.#options = options;
    void recoverAccountDeletions(this.#options, (view) => {
      if (this.#view.kind === "guest") this.publish(view);
    });
    options.session.subscribe((view) => {
      const lease = view.kind === "authenticated" ? options.session.authorize() : undefined;
      this.#lease = lease;
      this.administration.bind(lease);
      this.garage.bind(lease);
      this.#archive = [];
      this.#reauth = false;

      if (view.kind !== "authenticated" || lease === undefined) {
        this.publish({ kind: "guest" });

        return;
      }

      this.publish(initialAccountData(view.user));
      void this.refresh().then(() => (lease.current() ? this.retry("resume") : undefined));
    });
  }

  view(): AccountDataView {
    return this.#view;
  }

  subscribe(listener: (view: AccountDataView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  private publish(view: AccountDataView): void {
    this.#view = view;

    for (const listener of this.#listeners) listener(view);
  }

  /** Bound so loaders can take it as their patch callback. */
  private readonly patchAccount = (
    lease: LeaseBinding,
    patch: Partial<Extract<AccountDataView, { readonly kind: "account" }>>,
  ): void => {
    this.patch(lease, patch);
  };

  private patch(
    lease: LeaseBinding,
    patch: Partial<Extract<AccountDataView, { readonly kind: "account" }>>,
  ): void {
    if (lease.current() && this.#lease === lease && this.#view.kind === "account")
      this.publish({ ...this.#view, ...patch });
  }

  exportAccount(): Promise<AccountExport | undefined> {
    return exportAccountData(this.#lease, (lease, message) => {
      this.patch(lease, { message });
    });
  }

  deleteAccount(confirmation: string): Promise<boolean> {
    return deleteAccountData(
      this.#lease,
      confirmation,
      this.#options,
      (view) => {
        this.publish(view);
      },
      (lease, message) => {
        this.patch(lease, { message });
      },
    );
  }

  async recoverDeletions(): Promise<void> {
    await recoverAccountDeletions(this.#options, (view) => {
      if (this.#view.kind === "guest") this.publish(view);
    });
  }

  async refresh(): Promise<void> {
    const lease = this.#lease;

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
      this.patch(lease, { profile: { kind: "ready", value: await lease.profile.load() } });
    } catch {
      this.patch(lease, { profile: { kind: "failed" } });
    }
  }

  async nextHistory(): Promise<void> {
    const lease = this.#lease;
    const cursor = historyCursor(this.#view);

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
    const lease = this.#lease;

    if (lease === undefined) return;
    await claimArchivedRide(lease, this.#archive, rideId, this.#options.nowMs, (current, row) => {
      return this.queue(current, row);
    });
  }

  async queueProfile(): Promise<void> {
    const lease = this.#lease;

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
      this.patch(lease, {
        message: "Snapshot dauerhaft diesem Konto zugeordnet. Synchronisierung wird versucht.",
      });
      await this.loadRows(lease);

      if (lease.current()) await this.retry();
    } catch (error) {
      this.patch(lease, {
        message: `Nicht dauerhaft vorgemerkt. ${error instanceof Error ? error.message : "Speicherfehler."}`,
      });
    }
  }

  async applyProfile(): Promise<void> {
    const lease = this.#lease;
    const view = this.#view;

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

      this.patch(lease, {
        message: profileApplicationMessage(outcome),
      });
    } catch {
      this.patch(lease, {
        message: "Serverprofil nicht lokal gespeichert. Bisheriges Profil bleibt maßgeblich.",
      });
    }
  }

  async retry(mode: "manual" | "resume" = "manual"): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined || this.#reauth) return;

    if (this.#sending.has(lease.generation)) {
      if (mode === "manual" || !this.#pending.has(lease.generation))
        this.#pending.set(lease.generation, mode);

      return;
    }

    this.#sending.add(lease.generation);

    try {
      const database = await this.#options.outbox();
      const rows = await database.list(lease);
      await this.deliverNext(lease, database, rows, 0, mode);

      if (lease.current())
        await Promise.all([this.loadProfile(lease), loadHistory(lease, null, this.patchAccount)]);
    } catch {
      this.patch(lease, {
        message: "Speicheränderung nicht bestätigt. Bitte später aktualisieren.",
      });
    } finally {
      this.#sending.delete(lease.generation);

      const pending = this.#pending.get(lease.generation);
      this.#pending.delete(lease.generation);

      if (pending !== undefined && lease.current()) void this.retry(pending);
    }
  }

  private async deliverNext(
    lease: AccountSyncLease,
    database: AccountOutbox,
    rows: readonly OutboxRow[],
    index: number,
    mode: "manual" | "resume",
  ): Promise<void> {
    const row = rows[index];

    if (row === undefined || !lease.current() || this.#reauth) return;
    const outcome = await deliverAccountRow(lease, database, row, this.#options.nowMs, mode);

    if (!lease.current()) return;
    this.#reauth = outcome === "reauth";

    if (this.#reauth)
      this.patch(lease, { message: "Abmelden, neu anmelden. Speicherstatus ggf. unbestätigt." });
    await this.loadRows(lease);
    await this.deliverNext(lease, database, rows, index + 1, mode);
  }
}
