import { archivedRideTrack, RideUploadSchema, type ArchivedRide } from "@voltonaut/shared";

import {
  historyCursor,
  initialAccountData,
  loadedOutbox,
  localArchiveView,
  profileApplicationMessage,
  type AccountDataView,
  type SyncOptions,
} from "./accountDataView.js";
import {
  newOutboxRow,
  type AccountOutbox,
  type OutboxRead,
  type OutboxRow,
} from "./accountOutbox.js";
import { deliverAccountRow } from "./accountDelivery.js";
import { applyAccountProfile } from "./accountProfile.js";
import type { AccountLease } from "./privateAuthTransport.js";

export class AccountSync {
  readonly #options: SyncOptions;
  readonly #listeners = new Set<(view: AccountDataView) => void>();
  readonly #sending = new Set<number>();
  readonly #pending = new Map<number, "manual" | "resume">();
  #view: AccountDataView = { kind: "guest" };
  #lease: AccountLease | undefined;
  #archive: readonly ArchivedRide[] = [];
  #reauth = false;

  constructor(options: SyncOptions) {
    this.#options = options;
    options.session.subscribe((view) => {
      this.#lease = undefined;
      this.#archive = [];
      this.#reauth = false;

      if (view.kind !== "authenticated") {
        this.publish({ kind: "guest" });

        return;
      }

      const lease = options.session.authorize();

      if (lease === undefined) {
        this.publish({ kind: "guest" });

        return;
      }

      this.#lease = lease;
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

  private patch(
    lease: AccountLease,
    patch: Partial<Extract<AccountDataView, { readonly kind: "account" }>>,
  ): void {
    if (lease.current() && this.#lease === lease && this.#view.kind === "account")
      this.publish({ ...this.#view, ...patch });
  }

  async refresh(): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined) return;
    await Promise.all([
      this.loadProfile(lease),
      this.loadHistory(lease, null),
      this.loadLocal(lease),
      this.loadRows(lease),
    ]);
  }

  private async loadProfile(lease: AccountLease): Promise<void> {
    try {
      this.patch(lease, { profile: { kind: "ready", value: await lease.profile() } });
    } catch {
      this.patch(lease, { profile: { kind: "failed" } });
    }
  }

  private async loadHistory(lease: AccountLease, cursor: string | null): Promise<void> {
    try {
      const value = await lease.history(cursor);
      this.patch(lease, { history: { kind: "ready", value } });
    } catch {
      this.patch(lease, { history: { kind: "failed" } });
    }
  }

  async nextHistory(): Promise<void> {
    const lease = this.#lease;
    const cursor = historyCursor(this.#view);

    if (lease !== undefined && cursor !== null) await this.loadHistory(lease, cursor);
  }

  private async loadLocal(lease: AccountLease): Promise<void> {
    try {
      const archive = await this.#options.archive();

      if (!lease.current()) return;
      this.#archive = archive;
      this.patch(lease, { local: localArchiveView(archive) });
    } catch {
      this.patch(lease, {
        message: "Lokales Archiv nicht verfügbar. Aufnahme und TCX bleiben unabhängig.",
      });
    }
  }

  private async loadRows(lease: AccountLease): Promise<OutboxRead> {
    this.patch(lease, { outbox: { kind: "loading" } });

    try {
      const rows = await (await this.#options.outbox()).list(lease);

      this.patch(lease, { outbox: loadedOutbox(rows) });

      return { kind: "ready", rows };
    } catch {
      this.patch(lease, {
        outbox: { kind: "failed" },
        message:
          "Kontowarteschlange nicht verfügbar. Neue Aufträge sind nicht dauerhaft vorgemerkt.",
      });

      return { kind: "failed" };
    }
  }

  async claim(rideId: string): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined) return;
    const ride = this.#archive.find((item) => archivedRideTrack(item).rideId === rideId);

    if (ride === undefined || ride.kind === "local_only") return;
    await this.queue(
      lease,
      newOutboxRow(lease, RideUploadSchema.parse(ride.recording), this.#options.nowMs()),
    );
  }

  async queueProfile(): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined) return;

    try {
      const profile = await this.#options.profile.saved();

      if (!lease.current()) return;

      if (profile === undefined) {
        this.patch(lease, {
          message: "Noch kein lokal gespeichertes Profil. Zuerst das Profilformular speichern.",
        });

        return;
      }

      await this.queue(lease, newOutboxRow(lease, profile, this.#options.nowMs()));
    } catch {
      this.patch(lease, { message: "Lokales Profil nicht lesbar. Nicht vorgemerkt." });
    }
  }

  private async queue(lease: AccountLease, row: OutboxRow): Promise<void> {
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
        await Promise.all([this.loadProfile(lease), this.loadHistory(lease, null)]);
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
    lease: AccountLease,
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
