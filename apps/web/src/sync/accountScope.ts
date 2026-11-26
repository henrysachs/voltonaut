import type { User } from "@voltonaut/shared";
import type { LeaseBinding } from "./apiRoute.js";
import type { ApplicationSession, SessionView } from "./applicationSession.js";

export type SignedOutSession = Exclude<SessionView, { readonly kind: "authenticated" }>;

interface SignedOut {
  readonly kind: "signedOut";
  /** Guests and pending logins differ for features that buffer while a session is restored. */
  readonly session: SignedOutSession;
}

interface SignedInAccount {
  readonly user: Readonly<User>;
  /** False when the session lives only in this tab. */
  readonly persistent: boolean;
}

/**
 * The account every feature is bound to. A signed-in binding carries its own lease: that lease
 * is current only while the binding is still the bound one and the session generation is valid.
 */
export type AccountBinding<L extends LeaseBinding> =
  | SignedOut
  | ({ readonly kind: "signedIn"; readonly lease: L } & SignedInAccount);

export type SignedInBinding<L extends LeaseBinding> = Extract<
  AccountBinding<L>,
  { readonly kind: "signedIn" }
>;

/** Read side of the account scope; each feature follows it with the ports it needs. */
export interface AccountScope<L extends LeaseBinding> {
  /** Calls `listener` with the current binding, then with every change. */
  readonly subscribe: (listener: (binding: AccountBinding<L>) => void) => () => void;
  /**
   * Runs `flush` once a binding change in progress reached every feature, so no listener sees
   * one feature bound to the new account and another one still bound to the old account.
   */
  readonly deliver: (flush: () => void) => void;
}

/**
 * Owns the binding of all account features. A binding ends when the session signs out, is
 * replaced or the account is deleted; its lease then stops being current for every feature.
 * Tests drive it directly as an in-memory scope.
 */
export class AccountScopeSource<L extends LeaseBinding> implements AccountScope<L> {
  readonly #listeners = new Set<(binding: AccountBinding<L>) => void>();
  readonly #pending = new Set<() => void>();
  #binding: AccountBinding<L> = { kind: "signedOut", session: { kind: "guest", message: "" } };
  /** Aborts the signal of the current binding's lease. */
  #end: () => void = () => {};
  #depth = 0;

  subscribe(listener: (binding: AccountBinding<L>) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#binding);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  deliver(flush: () => void): void {
    if (this.#depth === 0) flush();
    else this.#pending.add(flush);
  }

  signOut(session: SignedOutSession): void {
    this.#binding = { kind: "signedOut", session };
    this.#announce(() => {});
  }

  /** Binds `lease`; a repeated sign-in of the same account generation keeps the binding. */
  signIn(lease: L, account: SignedInAccount): void {
    const previous = this.#binding;

    if (
      previous.kind === "signedIn" &&
      previous.lease.generation === lease.generation &&
      previous.lease.userId === lease.userId
    )
      return;

    const ended = new AbortController();

    const binding: AccountBinding<L> = {
      kind: "signedIn",
      lease: {
        ...lease,
        signal: AbortSignal.any([lease.signal, ended.signal]),
        current: () => this.#binding === binding && lease.current(),
      },
      user: account.user,
      persistent: account.persistent,
    };

    this.#binding = binding;
    this.#announce(() => {
      ended.abort();
    });
  }

  /** Ends the previous binding and hands the new one to every feature. */
  #announce(end: () => void): void {
    const previous = this.#end;
    const binding = this.#binding;
    this.#end = end;
    previous();
    this.#depth += 1;

    try {
      for (const listener of this.#listeners) listener(binding);
    } finally {
      this.#depth -= 1;

      if (this.#depth === 0) {
        const pending = [...this.#pending];
        this.#pending.clear();

        for (const flush of pending) flush();
      }
    }
  }
}

/** Follows the application session: every authenticated generation becomes one binding. */
export function sessionAccountScope<L extends LeaseBinding>(
  session: Readonly<Pick<ApplicationSession<L>, "authorize" | "subscribe">>,
): AccountScope<L> {
  const source = new AccountScopeSource<L>();

  session.subscribe((view) => {
    if (view.kind !== "authenticated") {
      source.signOut(view);

      return;
    }

    const lease = session.authorize();

    if (lease !== undefined) source.signIn(lease, view);
  });

  return source;
}
