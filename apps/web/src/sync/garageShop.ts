import { PrivateRequestError, type LeaseBinding, type SyncFailure } from "./apiRoute.js";
import { AccountLane, type AccountTurn } from "./accountLane.js";
import type { AccountScope } from "./accountScope.js";
import { AccountState } from "./accountState.js";
import { ShopReceiptMismatch, type ShopPort } from "./shopPort.js";

/** The garage reads and buys through the shop port only. */
export type ShopLease = LeaseBinding & {
  readonly shop: Pick<ShopPort, "balance" | "inventory" | "purchase">;
};

export type GarageShopView =
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly voltsBalance: number;
      readonly ownedItemIds: readonly string[];
      /** Item whose purchase is waiting for the server; at most one at a time. */
      readonly pendingItemId: string | null;
      readonly message: string;
      /** Item the message is about; `null` for messages about the whole shop. */
      readonly messageItemId: string | null;
    };

type ReadyView = Extract<GarageShopView, { readonly kind: "ready" }>;

const UNREACHABLE = "Shop nicht erreichbar. Besitz und Volts nicht bestätigt.";

const REJECTED =
  "Kauf abgelehnt: Preis, Besitz oder Guthaben passt nicht mehr. Serverstand neu gelesen.";

const BOUGHT = "Gekauft. Das Item gehört jetzt zu deinem Konto.";

/** Final server answers: the same request can never succeed, so a retry needs a new id. */
const REJECTIONS: ReadonlySet<SyncFailure> = new Set([
  "conflict",
  "missing",
  "forbidden",
  "contract",
]);

const UNCONFIRMED =
  "Kauf nicht bestätigt. Ein neuer Versuch nutzt dieselbe Anfrage, ohne doppelte Abbuchung.";

/**
 * Server-confirmed Volts balance and inventory for the garage (spec E7-02 AK8).
 * Owns no authoritative state: every value comes from the account's server.
 */
export class GarageShop {
  readonly #state: AccountState<GarageShopView, ShopLease>;
  /** The newest purchase or read wins; older answers are dropped. */
  readonly #lane = new AccountLane();
  /** Unconfirmed purchases keep their request id so a retry cannot charge twice. */
  readonly #retryIds = new Map<string, string>();
  readonly #newRequestId: () => string;
  #retryUserId: string | undefined;

  constructor(
    scope: AccountScope<ShopLease>,
    newRequestId: () => string = () => crypto.randomUUID(),
  ) {
    this.#newRequestId = newRequestId;
    this.#state = new AccountState<GarageShopView, ShopLease>(
      { kind: "guest" },
      {
        enter: (binding) => {
          // A re-authenticated session of the same account keeps open request ids (ADR-031 §3).
          // The session passes through a signed-out state on the way, so only another account
          // clears them.
          if (binding.kind === "signedIn") {
            if (binding.lease.userId !== this.#retryUserId) this.#retryIds.clear();
            this.#retryUserId = binding.lease.userId;
          }

          return { kind: binding.kind === "signedIn" ? "loading" : "guest" };
        },
        start: ({ lease }) => {
          void this.refresh(lease, "", null);
        },
      },
    );
    this.#state.follow(scope);
  }

  /** Rereads a shop that could not be loaded, e.g. when the browser is back online. */
  async retry(): Promise<void> {
    const lease = this.#state.lease();

    if (lease === undefined || this.#state.view().kind !== "failed") return;
    this.#state.publish({ kind: "loading" });
    await this.refresh(lease, "", null);
  }

  view(): GarageShopView {
    return this.#state.view();
  }

  subscribe(listener: (view: GarageShopView) => void): () => void {
    return this.#state.subscribe(listener);
  }

  /** Buys one item at the price the garage shows; ignored while another purchase is open. */
  async purchase(itemId: string, priceVolts: number): Promise<void> {
    const lease = this.#state.lease();
    const view = this.#state.view();

    if (lease === undefined || view.kind !== "ready" || view.pendingItemId !== null) return;
    const requestId = this.#retryIds.get(itemId) ?? this.#newRequestId();
    const turn = this.#lane.begin(lease);
    this.#retryIds.set(itemId, requestId);
    this.#state.publish({
      ...view,
      pendingItemId: itemId,
      message: "Kauf wird bestätigt …",
      messageItemId: itemId,
    });

    try {
      const receipt = await lease.shop.purchase({
        requestId,
        itemId,
        expectedPriceVolts: priceVolts,
      });

      if (!turn.current()) return;
      this.#retryIds.delete(itemId);

      // An earlier unconfirmed purchase may have committed; reread instead of mixing states.
      if (this.#retryIds.size > 0) {
        await this.refresh(lease, BOUGHT, itemId);

        return;
      }

      this.#state.publish({
        kind: "ready",
        voltsBalance: receipt.voltsBalance,
        ownedItemIds: [...new Set([...view.ownedItemIds, receipt.item.itemId])],
        pendingItemId: null,
        message: BOUGHT,
        messageItemId: itemId,
      });
    } catch (error) {
      const rejected =
        error instanceof ShopReceiptMismatch ||
        (error instanceof PrivateRequestError && REJECTIONS.has(error.cause));

      if (turn.current()) await this.failPurchase(lease, view, itemId, rejected);
    }
  }

  private async failPurchase(
    lease: ShopLease,
    view: ReadyView,
    itemId: string,
    rejected: boolean,
  ): Promise<void> {
    if (rejected) {
      this.#retryIds.delete(itemId);
      await this.refresh(lease, REJECTED, itemId);

      return;
    }

    this.#state.publish({
      ...view,
      pendingItemId: null,
      message: UNCONFIRMED,
      messageItemId: itemId,
    });
  }

  private async refresh(
    lease: ShopLease,
    message: string,
    messageItemId: string | null,
  ): Promise<void> {
    const turn: AccountTurn = this.#lane.begin(lease);

    try {
      const [balance, inventory] = await Promise.all([
        lease.shop.balance(),
        lease.shop.inventory(),
      ]);

      if (!turn.current()) return;

      const ownedItemIds = inventory.items.map(({ itemId }) => itemId);

      for (const itemId of ownedItemIds) this.#retryIds.delete(itemId);
      this.#state.publish({
        kind: "ready",
        voltsBalance: balance.voltsBalance,
        ownedItemIds,
        pendingItemId: null,
        message,
        messageItemId,
      });
    } catch {
      this.#state.update(turn, () => ({ kind: "failed", message: UNREACHABLE }));
    }
  }
}
