import type { ProgressHistoryJournal } from "@voltonaut/shared";

import type { LeaseBinding } from "./apiRoute.js";
import { AccountLane } from "./accountLane.js";
import type { AccountScope } from "./accountScope.js";
import { AccountState } from "./accountState.js";
import type { ProgressPort } from "./progressPort.js";
import type { ShopPort } from "./shopPort.js";

/** The history reads confirmed journals and the balance; it never writes. */
export type ProgressHistoryLease = LeaseBinding & {
  readonly progress: Pick<ProgressPort, "history">;
  readonly shop: Pick<ShopPort, "balance">;
};

export type ProgressHistoryView =
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly voltsBalance: number;
      readonly journals: readonly ProgressHistoryJournal[];
      /** More journals exist than the newest page shows. */
      readonly truncated: boolean;
    };

const UNREACHABLE = "Historie nicht erreichbar. Kein bestätigter Stand angezeigt.";

/**
 * Server-confirmed ride history and balance (spec E6-11 AK5). Owns no state of its own:
 * every value is a server answer, and a failed read shows no numbers.
 */
export class ProgressHistory {
  readonly #state: AccountState<ProgressHistoryView, ProgressHistoryLease>;
  /** The newest read wins; an older answer is dropped. */
  readonly #lane = new AccountLane();

  constructor(scope: AccountScope<ProgressHistoryLease>) {
    this.#state = new AccountState<ProgressHistoryView, ProgressHistoryLease>(
      { kind: "guest" },
      {
        enter: (binding) => ({ kind: binding.kind === "signedIn" ? "loading" : "guest" }),
        start: ({ lease }) => {
          void this.read(lease);
        },
      },
    );
    this.#state.follow(scope);
  }

  view(): ProgressHistoryView {
    return this.#state.view();
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The view holds readonly journals with Zod brands the rule cannot resolve.
  subscribe(listener: (view: ProgressHistoryView) => void): () => void {
    return this.#state.subscribe(listener);
  }

  /** Rereads after a new receipt, a retry or when the browser is back online. */
  async refresh(): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined) return;
    await this.read(lease);
  }

  private async read(lease: ProgressHistoryLease): Promise<void> {
    const turn = this.#lane.begin(lease);

    try {
      const [balance, page] = await Promise.all([lease.shop.balance(), lease.progress.history()]);

      this.#state.update(turn, () => ({
        kind: "ready",
        voltsBalance: balance.voltsBalance,
        journals: page.journals,
        truncated: page.nextCursor !== null,
      }));
    } catch {
      this.#state.update(turn, () => ({ kind: "failed", message: UNREACHABLE }));
    }
  }
}

/**
 * Rereads the history once per delivered batch rather than once per receipt in it
 * (spec E6-11 AK5). `schedule` defaults to a one-second timer.
 */
export function rereadOnReceipts(
  progress: Readonly<{ subscribeReceipts: (listener: () => void) => () => void }>,
  history: Readonly<Pick<ProgressHistory, "refresh">>,
  schedule: (callback: () => void) => void = (callback) => {
    setTimeout(callback, 1000);
  },
): () => void {
  let pending = false;

  return progress.subscribeReceipts(() => {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      void history.refresh();
    });
  });
}
