import type { LeaseBinding } from "./apiRoute.js";
import type { AccountBinding, AccountScope, SignedInBinding } from "./accountScope.js";

/** How one feature reacts to a binding change. */
export interface AccountFeature<V, L extends LeaseBinding> {
  /**
   * View for a new binding, derived before any listener sees the change. Returning `previous`
   * keeps the view and publishes nothing.
   */
  readonly enter: (binding: AccountBinding<L>, previous: V) => V;
  /** Work a signed-in binding starts once its first view is in place, e.g. initial reads. */
  readonly start?: (binding: SignedInBinding<L>) => void;
}

/**
 * Observable state of one feature inside the account scope. Asynchronous results pass `update`
 * with the lease they started with; results of an ended binding or turn are dropped.
 */
export class AccountState<V, L extends LeaseBinding> {
  readonly #feature: AccountFeature<V, L>;
  readonly #listeners = new Set<(view: V) => void>();
  readonly #flush = (): void => {
    for (const listener of this.#listeners) listener(this.#view);
  };
  #view: V;
  #binding: AccountBinding<L> | undefined;
  #scope: AccountScope<L> | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(initial: V, feature: AccountFeature<V, L>) {
    this.#view = initial;
    this.#feature = feature;
  }

  /**
   * Starts following `scope`. The owning store calls this last in its constructor: the current
   * binding is entered immediately and may already start work on the store.
   */
  follow(scope: AccountScope<L>): void {
    this.#unsubscribe?.();
    this.#scope = scope;
    this.#unsubscribe = scope.subscribe((binding) => {
      this.#enter(binding);
    });
  }

  /** The lease of the current signed-in binding; actions capture it when they start. */
  lease(): L | undefined {
    return this.#binding?.kind === "signedIn" ? this.#binding.lease : undefined;
  }

  view(): V {
    return this.#view;
  }

  subscribe(listener: (view: V) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Publishes regardless of the binding, for results that end a binding themselves. */
  publish(view: V): void {
    this.#view = view;

    if (this.#scope === undefined) this.#flush();
    else this.#scope.deliver(this.#flush);
  }

  /** Publishes `next(view)` only while `lease` is current and only if the view changed. */
  update(lease: Readonly<Pick<LeaseBinding, "current">>, next: (view: V) => V): void {
    if (!lease.current()) return;
    const view = next(this.#view);

    if (view !== this.#view) this.publish(view);
  }

  /** Wraps a rendered action so it only runs while the binding it was rendered for is current. */
  guard(action: () => void): () => void {
    const lease = this.lease();

    return () => {
      if (lease?.current() === true) action();
    };
  }

  close(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }

  #enter(binding: AccountBinding<L>): void {
    this.#binding = binding;
    const next = this.#feature.enter(binding, this.#view);

    if (next !== this.#view) this.publish(next);

    if (binding.kind === "signedIn") this.#feature.start?.(binding);
  }
}
