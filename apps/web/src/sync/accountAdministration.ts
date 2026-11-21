import type { AccountStatus, AdminUser, AdminUsers, Membership } from "@voltonaut/shared";
import type { AccountLease } from "./privateAuthTransport.js";

type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };

export type AdministrationUser = Immutable<AdminUser>;

export type AdministrationView = Immutable<
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly status: Readonly<AccountStatus>;
      readonly directory: Readonly<AdminUsers> | null;
      readonly busy: boolean;
      readonly message: string;
    }
>;

export class AccountAdministration {
  readonly #listeners = new Set<(view: AdministrationView) => void>();
  #view: AdministrationView = { kind: "guest" };
  #lease: AccountLease | undefined;
  #writing: AccountLease | undefined;
  #revision = 0;
  #cursor: string | null = null;

  bind(lease?: AccountLease): void {
    this.#lease = lease;
    this.#writing = undefined;
    this.#revision += 1;
    this.#cursor = null;
    this.publish({ kind: lease === undefined ? "guest" : "loading" });

    if (lease !== undefined) void this.refresh(lease);
  }

  subscribe(listener: (view: AdministrationView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  actions() {
    const lease = this.#lease;
    const next = this.#view.kind === "ready" ? this.#view.directory?.nextCursor : null;

    return Object.freeze({
      refresh: () =>
        lease === undefined || this.#writing !== undefined
          ? Promise.resolve()
          : this.refresh(lease),
      next: () =>
        lease === undefined || next === null || next === undefined || this.#writing !== undefined
          ? Promise.resolve()
          : this.refresh(lease, next),
      save: (userId: string, membership: Readonly<Membership>) =>
        lease === undefined ? Promise.resolve() : this.save(lease, userId, membership),
    });
  }

  private current(lease: AccountLease): boolean {
    return this.#lease === lease && lease.current();
  }

  private publish(view: AdministrationView): void {
    this.#view = view;

    for (const listener of this.#listeners) listener(view);
  }

  private async refresh(lease: AccountLease, cursor: string | null = null): Promise<void> {
    if (!this.current(lease)) return;
    const revision = ++this.#revision;
    this.publish({ kind: "loading" });

    try {
      const status = await lease.accountStatus();

      if (!this.current(lease) || revision !== this.#revision) return;

      const directory =
        status.authorization.role === "admin" ? await lease.adminUsers(cursor) : null;

      if (!this.current(lease) || revision !== this.#revision) return;
      this.#cursor = cursor;
      this.publish({ kind: "ready", status, directory, busy: false, message: "" });
    } catch {
      if (this.current(lease) && revision === this.#revision)
        this.publish({
          kind: "failed",
          message: "Mitgliedschaft nicht erreichbar. Serverstand nicht bestätigt.",
        });
    }
  }

  private async save(
    lease: AccountLease,
    userId: string,
    membership: Readonly<Membership>,
  ): Promise<void> {
    const view = this.#view;

    if (
      !this.current(lease) ||
      view.kind !== "ready" ||
      this.#writing !== undefined ||
      view.status.authorization.role !== "admin"
    )
      return;
    const revision = ++this.#revision;
    this.#writing = lease;
    this.publish({ ...view, busy: true, message: "Änderung wird bestätigt …" });

    try {
      await lease.saveMembership(userId, membership);

      if (!this.current(lease) || revision !== this.#revision) return;
      await this.refresh(lease, this.#cursor);
    } catch {
      if (!this.current(lease) || revision !== this.#revision) return;
      await this.refresh(lease, this.#cursor);

      if (!this.current(lease)) return;
      this.publish(
        this.#view.kind === "ready"
          ? {
              ...this.#view,
              message:
                "Änderung nicht bestätigt. Aktuellen Serverstand neu gelesen; keine automatische Wiederholung.",
            }
          : {
              kind: "failed",
              message:
                "Änderung nicht bestätigt. Serverstand nicht erreichbar; keine automatische Wiederholung.",
            },
      );
    } finally {
      if (this.#writing === lease) this.#writing = undefined;
    }
  }
}
