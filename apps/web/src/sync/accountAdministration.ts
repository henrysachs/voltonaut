import type { AccountStatus, AdminUser, AdminUsers, Membership } from "@voltonaut/shared";
import type { MembershipPort } from "./accountPorts.js";
import type { LeaseBinding } from "./apiRoute.js";
import { AccountLane } from "./accountLane.js";
import type { AccountScope } from "./accountScope.js";
import { AccountState } from "./accountState.js";

/** Membership reads and admin writes; writes are never retried (ADR-021). */
export type MembershipLease = LeaseBinding & { readonly membership: MembershipPort };

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
  readonly #state: AccountState<AdministrationView, MembershipLease>;
  /** The newest read or write wins; older answers are dropped. */
  readonly #lane = new AccountLane();
  /** A write holds its binding until its authoritative readback completed. */
  #writing: MembershipLease | undefined;
  #cursor: string | null = null;

  constructor(scope: AccountScope<MembershipLease>) {
    this.#state = new AccountState<AdministrationView, MembershipLease>(
      { kind: "guest" },
      {
        enter: (binding) => {
          this.#writing = undefined;
          this.#cursor = null;

          return { kind: binding.kind === "signedIn" ? "loading" : "guest" };
        },
        start: ({ lease }) => {
          void this.refresh(lease);
        },
      },
    );
    this.#state.follow(scope);
  }

  subscribe(listener: (view: AdministrationView) => void): () => void {
    return this.#state.subscribe(listener);
  }

  actions() {
    const lease = this.#state.lease();
    const view = this.#state.view();
    const next = view.kind === "ready" ? view.directory?.nextCursor : null;

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

  private async refresh(lease: MembershipLease, cursor: string | null = null): Promise<void> {
    if (!lease.current()) return;
    const turn = this.#lane.begin(lease);
    this.#state.publish({ kind: "loading" });

    try {
      const status = await lease.membership.status();

      if (!turn.current()) return;

      const directory =
        status.authorization.role === "admin" ? await lease.membership.users(cursor) : null;

      if (!turn.current()) return;
      this.#cursor = cursor;
      this.#state.publish({ kind: "ready", status, directory, busy: false, message: "" });
    } catch {
      this.#state.update(turn, () => ({
        kind: "failed",
        message: "Mitgliedschaft nicht erreichbar. Serverstand nicht bestätigt.",
      }));
    }
  }

  private async save(
    lease: MembershipLease,
    userId: string,
    membership: Readonly<Membership>,
  ): Promise<void> {
    const view = this.#state.view();

    if (
      !lease.current() ||
      view.kind !== "ready" ||
      this.#writing !== undefined ||
      view.status.authorization.role !== "admin"
    )
      return;
    const turn = this.#lane.begin(lease);
    this.#writing = lease;
    this.#state.publish({ ...view, busy: true, message: "Änderung wird bestätigt …" });

    try {
      await lease.membership.save(userId, membership);

      if (!turn.current()) return;
      await this.refresh(lease, this.#cursor);
    } catch {
      if (!turn.current()) return;
      await this.refresh(lease, this.#cursor);
      this.#state.update(lease, (current) =>
        current.kind === "ready"
          ? {
              ...current,
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
